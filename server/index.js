import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, PUBLIC_DIR, FILES_DIR, PORT } from './config.js';
import { catalogPayload } from './graph.js';
import { CREDENTIAL_TYPES } from './engine/catalog.js';
import * as store from './store.js';
import { startRun, stopRun, subscribe, replayFromDb, isLive, activeRuns } from './runs.js';
import { syncAll, syncWorkflow, scheduleOverview, validateCron } from './scheduler.js';
import { listCredentials, publicCredential, createCredential, updateCredential, deleteCredential } from './credentials.js';
import { aiStatusAsync } from './engine/ai.js';
import { desktopStatus } from './engine/desktop.js';
import { generateWorkflow } from './generation.js';
import { seedIfEmpty } from './seed.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

// Live state is polled while runs are in flight; a cached snapshot would look frozen.
app.use('/api', (req, res, next) => {
  res.set('cache-control', 'no-store');
  next();
});

const fail = (res, status, err) => res.status(status).json({ error: err?.message || String(err) });

/* ------------------------------ meta ------------------------------ */

app.get('/api/meta', async (req, res) => {
  res.json({
    name: 'Cascade',
    version: '1.0.0',
    catalog: catalogPayload(),
    credentialTypes: CREDENTIAL_TYPES,
    ai: await aiStatusAsync(),
    desktop: await desktopStatus(),
    schedules: scheduleOverview(),
    activeRuns: activeRuns(),
    now: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));

/* --------------------------- workflows --------------------------- */

app.get('/api/workflows', (req, res) => res.json(store.listWorkflows()));

app.get('/api/workflows/:id', (req, res) => {
  const workflow = store.getWorkflow(req.params.id);
  if (!workflow) return fail(res, 404, new Error('Workflow not found.'));
  res.json(workflow);
});

app.post('/api/workflows', (req, res) => {
  try {
    const { workflow, warnings } = store.createWorkflow(req.body || {});
    syncWorkflow(workflow.id);
    res.status(201).json({ workflow, warnings });
  } catch (err) { fail(res, 400, err); }
});

app.put('/api/workflows/:id', (req, res) => {
  try {
    const result = store.updateWorkflow(req.params.id, req.body || {});
    if (!result) return fail(res, 404, new Error('Workflow not found.'));
    syncWorkflow(req.params.id);
    res.json(result);
  } catch (err) { fail(res, 400, err); }
});

app.delete('/api/workflows/:id', (req, res) => {
  const removed = store.deleteWorkflow(req.params.id);
  if (!removed) return fail(res, 404, new Error('Workflow not found.'));
  syncWorkflow(req.params.id);
  res.json({ ok: true });
});

app.post('/api/workflows/:id/duplicate', (req, res) => {
  const source = store.getWorkflow(req.params.id);
  if (!source) return fail(res, 404, new Error('Workflow not found.'));
  try {
    const { workflow } = store.createWorkflow({
      name: `${source.name} (copy)`,
      description: source.description,
      graph: source.graph,
      cron: source.cron,
      timezone: source.timezone,
      enabled: false,
    });
    res.status(201).json({ workflow });
  } catch (err) { fail(res, 400, err); }
});

/* ----------------------------- runs ----------------------------- */

app.post('/api/workflows/:id/run', (req, res) => {
  const workflow = store.getWorkflow(req.params.id);
  if (!workflow) return fail(res, 404, new Error('Workflow not found.'));
  const { input = {}, startNodeId = null } = req.body || {};
  const runId = startRun({ workflow, input, trigger: 'manual', startNodeId });
  res.status(202).json({ runId });
});

app.get('/api/runs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 40, 200);
  res.json(store.listRuns({ workflowId: req.query.workflowId || null, limit }));
});

app.get('/api/runs/:id', (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) return fail(res, 404, new Error('Run not found.'));
  res.json(run);
});

app.post('/api/runs/:id/cancel', (req, res) => {
  const stopped = stopRun(req.params.id);
  res.json({ ok: stopped, live: isLive(req.params.id) });
});

app.get('/api/runs/:id/stream', (req, res) => {
  const runId = req.params.id;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  let unsubscribe = () => {};
  if (isLive(runId)) {
    unsubscribe = subscribe(runId, send);
  } else {
    const events = replayFromDb(runId);
    if (!events) {
      send({ type: 'error', message: 'Run not found.' });
    } else {
      for (const event of events) send(event);
      // Late subscribers to a finished run get the full history and can close.
      res.write('event: done\ndata: {}\n\n');
    }
  }
  // "close" on the response means the client went away; "close" on the request fires as soon as the GET body is done.
  res.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});

/* -------------------------- credentials -------------------------- */

app.get('/api/credentials', (req, res) => res.json(listCredentials()));

app.post('/api/credentials', (req, res) => {
  try { const created = createCredential(req.body || {}); res.status(201).json(publicCredential(created.id)); } catch (err) { fail(res, 400, err); }
});

app.put('/api/credentials/:id', (req, res) => {
  try {
    const updated = updateCredential(req.params.id, req.body || {});
    if (!updated) return fail(res, 404, new Error('Connection not found.'));
    res.json(publicCredential(updated.id));
  } catch (err) { fail(res, 400, err); }
});

app.delete('/api/credentials/:id', (req, res) => {
  const removed = deleteCredential(req.params.id);
  if (!removed) return fail(res, 404, new Error('Connection not found.'));
  res.json({ ok: true });
});

/* --------------------------- schedules --------------------------- */

app.get('/api/schedules', (req, res) => res.json(scheduleOverview()));

app.post('/api/schedules/validate', (req, res) => {
  const { cron } = req.body || {};
  res.json({ valid: validateCron(cron), cron: cron || null });
});

app.put('/api/workflows/:id/schedule', (req, res) => {
  try {
    const { cron = null, timezone = 'UTC', enabled = false } = req.body || {};
    if (cron && !validateCron(cron)) return fail(res, 400, new Error(`"${cron}" is not a valid cron expression.`));
    const result = store.updateWorkflow(req.params.id, { cron, timezone, enabled });
    if (!result) return fail(res, 404, new Error('Workflow not found.'));
    syncWorkflow(req.params.id);
    res.json({ workflow: result.workflow, schedules: scheduleOverview() });
  } catch (err) { fail(res, 400, err); }
});

/* ---------------------------- webhooks ---------------------------- */

app.post('/api/hooks/:token', (req, res) => {
  const token = req.params.token;
  const workflow = store.listWorkflows()
    .map((w) => store.getWorkflow(w.id))
    .find((w) => (w.graph?.nodes || []).some((node) => node.type === 'trigger.webhook' && String(node.data?.path || '') === token));
  if (!workflow) return fail(res, 404, new Error('No workflow listens on this webhook.'));

  const triggerNode = workflow.graph.nodes.find((node) => node.type === 'trigger.webhook' && String(node.data?.path || '') === token);
  const secret = triggerNode?.data?.secret;
  if (secret) {
    const provided = String(req.get('x-cascade-secret') || req.query.secret || '');
    const a = Buffer.from(provided);
    const b = Buffer.from(String(secret));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail(res, 401, new Error('Invalid webhook secret.'));
  }
  const runId = startRun({ workflow, input: req.body ?? {}, trigger: 'webhook' });
  res.status(202).json({ runId, workflow: { id: workflow.id, name: workflow.name } });
});

/* ------------------------------- AI ------------------------------- */

app.get('/api/ai/status', async (req, res) => res.json(await aiStatusAsync()));

app.post('/api/ai/generate', async (req, res) => {
  try {
    const { prompt, credentialId = null } = req.body || {};
    const result = await generateWorkflow({ prompt, credentialId });
    res.json(result);
  } catch (err) { fail(res, 400, err); }
});

/* ----------------------------- files ----------------------------- */

app.use('/files', express.static(FILES_DIR, { maxAge: '1h', fallthrough: true }));

/* --------------------------- frontend ---------------------------- */

app.use('/api', (req, res) => fail(res, 404, new Error(`No API route for ${req.method} ${req.originalUrl}`)));

const indexHtml = path.join(PUBLIC_DIR, 'index.html');
const CLIENT_DIR = path.join(ROOT, 'client');
const devMode = process.env.NODE_ENV !== 'production' && fs.existsSync(path.join(CLIENT_DIR, 'index.html'));

if (devMode) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: CLIENT_DIR, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else if (fs.existsSync(indexHtml)) {
  app.use(express.static(PUBLIC_DIR, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(indexHtml);
  });
} else {
  app.get('/', (req, res) => res.status(503).type('text/plain').send('Cascade API is running, but the UI has not been built yet. Run: npm run build'));
}

const created = seedIfEmpty();
syncAll();
if (created) console.log(`[seed] created ${created} example workflows`);

app.listen(PORT, () => {
  console.log(`[cascade] listening on http://localhost:${PORT} (${devMode ? 'dev' : 'production'} mode)`);
});
