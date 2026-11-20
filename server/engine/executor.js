import nodemailer from 'nodemailer';
import { NODE_MAP } from './catalog.js';
import { evaluate, render } from './expr.js';
import { runJavaScript, runPython } from './sandbox.js';
import { runBrowserAction, closeRunSessions } from './browser.js';
import { runDesktopAction } from './desktop.js';
import { callLLM } from './ai.js';
import { getCredential } from '../credentials.js';

const MAX_LOOP_ITERATIONS = 500;
const activeRuns = new Map();

export function cancelRun(runId) {
  const state = activeRuns.get(runId);
  if (state) state.cancelled = true;
  return Boolean(state);
}

export function isRunActive(runId) { return activeRuns.has(runId); }

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (!signal) { setTimeout(resolve, ms); return; }
  const started = Date.now();
  const tick = setInterval(() => {
    if (signal.cancelled) { clearInterval(tick); reject(new Error('Run cancelled')); }
    else if (Date.now() - started >= ms) { clearInterval(tick); resolve(); }
  }, Math.min(200, Math.max(25, ms)));
});

const asText = (json) => {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  try { return JSON.stringify(json, null, 2); } catch { return String(json); }
};

const slug = (s) => String(s || 'step').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'step';

function safeJson(value, fallback = {}) {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function joinUrl(base, path) {
  if (!base) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${base.replace(/\/$/, '')}/${String(path || '').replace(/^\//, '')}`;
}

function credentialHeaders(cred) {
  const d = cred?.data || {};
  const headers = {};
  if (d.authType === 'bearer' && d.token) headers.Authorization = `Bearer ${d.token}`;
  else if (d.authType === 'basic' && d.username) headers.Authorization = `Basic ${Buffer.from(`${d.username}:${d.password || ''}`).toString('base64')}`;
  else if (d.authType === 'header' && d.headerName && d.headerValue) headers[d.headerName] = d.headerValue;
  let defaults = {};
  try { defaults = typeof d.headers === 'string' ? JSON.parse(d.headers) : (d.headers || {}); } catch { defaults = {}; }
  return { ...defaults, ...headers };
}

async function httpRequest({ method = 'GET', url, headers = {}, query = {}, body, bodyType = 'none', timeoutMs = 30000, credentialId }) {
  const cred = getCredential(credentialId);
  const finalUrl = new URL(joinUrl(cred?.data?.baseUrl, url));
  const params = { ...(typeof query === 'string' ? safeJson(query, {}) : query || {}) };
  for (const [k, v] of Object.entries(params)) if (v != null) finalUrl.searchParams.set(k, String(v));

  const finalHeaders = { 'user-agent': 'Cascade/1.0', ...credentialHeaders(cred), ...headers };
  const hasHeader = (name) => Object.keys(finalHeaders).some((h) => h.toLowerCase() === name);
  let payload;
  if (bodyType === 'json') {
    const parsed = typeof body === 'string' ? safeJson(body, body) : body;
    payload = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    if (!hasHeader('content-type')) finalHeaders['content-type'] = 'application/json';
  } else if (bodyType === 'text') {
    payload = String(body ?? '');
    if (!hasHeader('content-type')) finalHeaders['content-type'] = 'text/plain';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(finalUrl, { method, headers: finalHeaders, body: payload, signal: controller.signal });
    const raw = await res.text();
    const contentType = res.headers.get('content-type') || '';
    let parsed = raw;
    if (contentType.includes('json') || /^\s*[[{]/.test(raw)) {
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    }
    return {
      status: res.status,
      ok: res.ok,
      headers: Object.fromEntries(res.headers.entries()),
      url: finalUrl.toString(),
      body: parsed,
      raw: raw.length > 200000 ? `${raw.slice(0, 200000)}…` : raw,
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s: ${method} ${finalUrl}`);
    throw new Error(`${method} ${finalUrl} failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export class Executor {
  constructor({ runId, workflow, graph, trigger = 'manual', input = {}, startNodeId = null, onEvent = () => {}, runWorkflow = null, depth = 0 }) {
    this.runId = runId;
    this.workflow = workflow;
    this.graph = graph;
    this.triggerName = trigger;
    this.triggerInput = input ?? {};
    this.startNodeId = startNodeId;
    this.onEvent = onEvent;
    this.runWorkflow = runWorkflow;
    this.depth = depth;
    this.nodes = new Map((graph.nodes || []).map((n) => [n.id, n]));
    this.edges = (graph.edges || []).filter((e) => this.nodes.has(e.source) && this.nodes.has(e.target));
    this.results = new Map();
    this.logs = [];
    this.state = { cancelled: false };
    this.loopRegions = new Map();
    this.loopContinuationEdges = new Map();
    this.loopOwnerCache = new Map();
    this.workflowName = workflow?.name || 'workflow';
    this.startedAt = Date.now();
  }

  outgoingEdges(nodeId) { return this.edges.filter((e) => e.source === nodeId); }
  incomingEdges(nodeId) { return this.edges.filter((e) => e.target === nodeId); }
  labelFor(node) { return node.data?.label || NODE_MAP.get(node.type)?.label || node.type; }

  loopEndOwner(loopEndId) {
    if (this.loopOwnerCache.has(loopEndId)) return this.loopOwnerCache.get(loopEndId);
    const queue = this.incomingEdges(loopEndId).map((e) => e.source);
    const seen = new Set(queue);
    let owner = null;
    while (queue.length) {
      const id = queue.shift();
      if (this.nodes.get(id)?.type === 'core.loop') { owner = id; break; }
      for (const edge of this.incomingEdges(id)) {
        if (!seen.has(edge.source)) { seen.add(edge.source); queue.push(edge.source); }
      }
    }
    this.loopOwnerCache.set(loopEndId, owner);
    return owner;
  }

  computeLoopRegion(loopId) {
    if (this.loopRegions.has(loopId)) return this.loopRegions.get(loopId);
    const body = new Set();
    const loopEnds = new Set();
    const queue = this.outgoingEdges(loopId).filter((e) => (e.sourceHandle || 'main') === 'each').map((e) => e.target);
    while (queue.length) {
      const id = queue.shift();
      if (id === loopId || body.has(id)) continue;
      const node = this.nodes.get(id);
      if (!node) continue;
      body.add(id);
      if (node.type === 'core.loopEnd' && this.loopEndOwner(id) === loopId) { loopEnds.add(id); continue; }
      for (const edge of this.outgoingEdges(id)) queue.push(edge.target);
    }
    const region = { body, loopEnds };
    this.loopRegions.set(loopId, region);
    return region;
  }

  allLoopBodyNodes() {
    const all = new Set();
    for (const node of this.nodes.values()) {
      if (node.type !== 'core.loop') continue;
      for (const id of this.computeLoopRegion(node.id).body) all.add(id);
    }
    return all;
  }

  scopeWith(extra = {}) {
    const nodesScope = {};
    const steps = {};
    const counts = new Map();
    for (const [id, result] of this.results) {
      const node = this.nodes.get(id);
      const label = node?.data?.label || NODE_MAP.get(node?.type)?.label || id;
      const entry = { json: result.output?.json ?? null, text: result.output?.text ?? '', status: result.status, label, type: node?.type };
      nodesScope[id] = entry;
      const base = slug(label);
      const n = (counts.get(base) || 0) + 1;
      counts.set(base, n);
      steps[n === 1 ? base : `${base}_${n}`] = entry;
    }
    return {
      input: null,
      nodes: nodesScope,
      steps,
      trigger: { type: this.triggerName, input: this.triggerInput },
      vars: this.triggerInput?.vars || {},
      env: process.env,
      now: new Date().toISOString(),
      workflow: { id: this.workflow?.id, name: this.workflow?.name },
      ...extra,
    };
  }

  async run() {
    activeRuns.set(this.runId, this.state);
    this.onEvent({ type: 'run_start', runId: this.runId, workflowId: this.workflow?.id, workflowName: this.workflowName, startedAt: new Date().toISOString(), trigger: this.triggerName });

    let status = 'success';
    let error = null;
    try {
      const loopBodies = this.allLoopBodyNodes();
      let nodeIds = [...this.nodes.keys()].filter((id) => !loopBodies.has(id));

      if (this.startNodeId && this.nodes.has(this.startNodeId)) {
        const reachable = new Set();
        const queue = [this.startNodeId];
        while (queue.length) {
          const id = queue.shift();
          if (reachable.has(id)) continue;
          reachable.add(id);
          for (const edge of this.outgoingEdges(id)) queue.push(edge.target);
        }
        nodeIds = nodeIds.filter((id) => reachable.has(id));
      }

      const nodeSet = new Set(nodeIds);
      const roots = nodeIds.filter((id) => this.incomingEdges(id).every((e) => !nodeSet.has(e.source)));
      const entries = this.startNodeId && nodeSet.has(this.startNodeId)
        ? [this.startNodeId, ...roots.filter((id) => id !== this.startNodeId)]
        : roots;

      await this.runSegment({ nodeIds, entries: entries.length ? entries : nodeIds.slice(0, 1), scope: this.scopeWith({ input: this.triggerInput }) });

      if (this.state.cancelled) { status = 'cancelled'; error = 'Run cancelled'; }
    } catch (err) {
      status = this.state.cancelled ? 'cancelled' : 'error';
      error = this.state.cancelled ? 'Run cancelled' : err.message;
    } finally {
      await closeRunSessions(this.runId);
      activeRuns.delete(this.runId);
    }

    this.onEvent({
      type: 'run_end', runId: this.runId, status, error,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - this.startedAt,
      outputs: Object.fromEntries([...this.results].map(([id, r]) => [id, r.output?.json ?? null])),
    });
    return { status, error, results: this.results };
  }

  async runSegment({ nodeIds, entries, scope }) {
    const inside = new Set(nodeIds);
    const state = new Map();
    const edgeState = new Map();
    const incoming = new Map();
    const outgoing = new Map();

    for (const id of inside) { state.set(id, 'pending'); incoming.set(id, []); outgoing.set(id, []); }

    for (const edge of this.edges) {
      if (!inside.has(edge.source) || !inside.has(edge.target)) continue;
      incoming.get(edge.target).push(edge);
      outgoing.get(edge.source).push(edge);
      edgeState.set(edge.id, 'pending');
    }

    // Edges leaving a For-each body through its Loop end are the loop's continuation.
    for (const id of inside) {
      const node = this.nodes.get(id);
      if (node?.type !== 'core.loop') continue;
      const region = this.computeLoopRegion(id);
      const continuation = this.loopContinuationEdges.get(id) || [];
      for (const endId of region.loopEnds) {
        for (const edge of this.outgoingEdges(endId)) {
          if (!inside.has(edge.target)) continue;
          if (incoming.get(edge.target).some((e) => e.id === edge.id)) continue;
          incoming.get(edge.target).push(edge);
          edgeState.set(edge.id, 'pending');
          if (!continuation.some((e) => e.id === edge.id)) continuation.push(edge);
        }
      }
      this.loopContinuationEdges.set(id, continuation);
    }

    const entrySet = new Set(entries.filter((id) => inside.has(id)));
    for (const id of inside) {
      if (incoming.get(id).length === 0 && !entrySet.has(id)) {
        state.set(id, 'skipped');
        for (const edge of outgoing.get(id)) edgeState.set(edge.id, 'skipped');
      }
    }

    const ordered = [...inside].filter((id) => this.nodes.has(id));

    while (true) {
      if (this.state.cancelled) throw new Error('Run cancelled');
      const readyId = ordered.find((id) => {
        if (state.get(id) !== 'pending') return false;
        const inc = incoming.get(id);
        if (inc.length === 0) return entrySet.has(id);
        return inc.every((e) => edgeState.get(e.id) !== 'pending');
      });
      if (!readyId) break;

      const id = readyId;
      const node = this.nodes.get(id);
      const inc = incoming.get(id);
      const activeEdges = inc.filter((e) => edgeState.get(e.id) === 'active');

      if (inc.length > 0 && activeEdges.length === 0) {
        state.set(id, 'skipped');
        for (const edge of outgoing.get(id)) edgeState.set(edge.id, 'skipped');
        this.emit({ type: 'node_end', runId: this.runId, nodeId: id, nodeType: node.type, label: this.labelFor(node), status: 'skipped', durationMs: 0, iteration: 0 });
        continue;
      }

      const input = this.mergeInputs(activeEdges, scope);
      let result;
      try {
        result = await this.executeWithRetries(node, input, scope);
      } catch (err) {
        if (this.state.cancelled) { state.set(id, 'skipped'); throw err; }
        result = { status: 'error', error: err.message, output: { json: { error: err.message }, text: err.message } };
      }

      state.set(id, result.status === 'error' ? 'failed' : 'done');
      this.results.set(id, result);

      const handle = result.handle || 'main';
      for (const edge of outgoing.get(id)) {
        edgeState.set(edge.id, (edge.sourceHandle || 'main') === handle ? 'active' : 'skipped');
      }
      if (node.type === 'core.loop') {
        for (const edge of this.loopContinuationEdges.get(id) || []) {
          if (edgeState.has(edge.id)) edgeState.set(edge.id, 'active');
        }
      }

      if (result.status === 'error') {
        for (const [otherId, s] of state) if (s === 'pending') state.set(otherId, 'skipped');
        throw new Error(result.error || 'Node failed');
      }
    }

    for (const [id, s] of state) if (s === 'pending') state.set(id, 'skipped');
    return state;
  }

  mergeInputs(activeEdges, scope) {
    if (!activeEdges.length) return scope.input ?? this.triggerInput;
    const values = activeEdges.map((e) => this.results.get(e.source)?.output?.json ?? null);
    if (values.length === 1) return values[0];
    if (values.every((v) => v && typeof v === 'object' && !Array.isArray(v))) return Object.assign({}, ...values);
    return values;
  }

  emit(event) {
    if (event.type === 'log') this.logs.push(event);
    this.onEvent(event);
  }

  log(nodeId, level, message) {
    this.emit({ type: 'log', runId: this.runId, nodeId, level, message: String(message), ts: new Date().toISOString() });
  }

  async executeWithRetries(node, input, scope) {
    const retries = Math.min(Number(node.data?.retries) || 0, 3);
    const retryDelay = Math.min(Number(node.data?.retryDelaySeconds) || 2, 60);
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (this.state.cancelled) throw new Error('Run cancelled');
      if (attempt > 0) {
        this.log(node.id, 'warn', `Retrying (${attempt}/${retries}) after: ${String(lastError?.message || lastError).split('\n')[0]}`);
        await sleep(retryDelay * 1000, this.state);
      }
      try {
        return await this.executeNode(node, input, scope, attempt);
      } catch (err) {
        lastError = err;
        if (node.data?.continueOnError) {
          if (attempt >= retries) {
            this.log(node.id, 'warn', `Continuing after error: ${err.message}`);
            return { status: 'success', output: { json: { error: err.message }, text: err.message }, logs: [], durationMs: 0, handle: 'main', continueOnError: true };
          }
        } else if (!retries) {
          throw err;
        }
      }
    }
    throw lastError;
  }

  resolveConfig(node, scope) {
    const def = NODE_MAP.get(node.type);
    const codeFields = new Set((def?.fields || []).filter((f) => f.language === 'javascript' || f.language === 'python').map((f) => f.key));
    const rendered = {};
    for (const [key, value] of Object.entries(node.data || {})) {
      if (['label', 'retries', 'retryDelaySeconds', 'continueOnError'].includes(key)) continue;
      if (codeFields.has(key)) { rendered[key] = value; continue; }
      try { rendered[key] = render(value, scope); } catch (err) { throw new Error(`Could not resolve "${key}": ${err.message}`); }
    }
    return rendered;
  }

  async executeNode(node, input, scope, attempt = 0) {
    const startedAt = Date.now();
    const startedIso = new Date(startedAt).toISOString();
    const label = this.labelFor(node);
    const iteration = scope.index != null ? Number(scope.index) : 0;
    try {
      const nodeScope = this.scopeWith({ input, item: scope.item, index: scope.index, iteration: scope.iteration });
      this.emit({ type: 'node_start', runId: this.runId, nodeId: node.id, nodeType: node.type, label, startedAt: startedIso, iteration });

      const config = this.resolveConfig(node, nodeScope);
      let outcome;
      if (node.type === 'core.loop') {
        outcome = await this.executeLoop(node, config, nodeScope, input);
      } else {
        const handler = this.handlers[node.type];
        if (!handler) throw new Error(`No executor for node type "${node.type}".`);
        outcome = await handler(config, nodeScope, node);
      }

      const output = outcome?.output || { json: outcome?.json ?? null, text: outcome?.text ?? '' };
      const durationMs = Date.now() - startedAt;
      for (const entry of outcome?.logs || []) this.log(node.id, entry.level || 'info', entry.message);

      this.emit({
        type: 'node_end', runId: this.runId, nodeId: node.id, nodeType: node.type, label,
        status: 'success', output: output.json ?? null, text: output.text ?? '', durationMs,
        startedAt: startedIso, finishedAt: new Date().toISOString(), iteration, attempt,
      });
      return { status: 'success', output, logs: outcome?.logs || [], durationMs, handle: outcome?.handle || 'main' };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const message = this.state.cancelled ? 'Run cancelled' : err.message;
      this.emit({
        type: 'node_end', runId: this.runId, nodeId: node.id, nodeType: node.type, label,
        status: 'error', error: message, durationMs, startedAt: startedIso,
        finishedAt: new Date().toISOString(), iteration, attempt,
      });
      this.log(node.id, 'error', message);
      throw err;
    }
  }

  /* ---------- For each ---------- */

  async executeLoop(node, config, scope) {
    let items = config.items;
    if (typeof items === 'string') {
      try { items = evaluate(items, scope); } catch { /* keep the literal string for the error below */ }
    }
    if (!Array.isArray(items)) throw new Error(`For each needs an array, but got ${items === null ? 'null' : typeof items}. Check the "Items" expression.`);

    const max = Math.min(Number(config.maxIterations) || MAX_LOOP_ITERATIONS, MAX_LOOP_ITERATIONS);
    const limited = items.slice(0, max);
    if (items.length > max) this.log(node.id, 'warn', `Only the first ${max} of ${items.length} items will run.`);

    const region = this.computeLoopRegion(node.id);
    if (!region.body.size) throw new Error('This For each has no body. Connect its "each" output to the steps you want to repeat.');
    if (!region.loopEnds.size) this.log(node.id, 'warn', 'No Loop end found inside this For each body; the body will run to its last node.');

    const bodyEntries = this.outgoingEdges(node.id)
      .filter((e) => (e.sourceHandle || 'main') === 'each')
      .map((e) => e.target)
      .filter((id) => region.body.has(id));

    const aggregates = [];
    for (let i = 0; i < limited.length; i += 1) {
      if (this.state.cancelled) throw new Error('Run cancelled');
      const iterationScope = { ...scope, item: limited[i], index: i, iteration: i, input: limited[i] };
      const produced = await this.runLoopBody({ region, entries: bodyEntries, scope: iterationScope });
      const terminal = this.pickTerminalOutput(region, produced);
      const json = terminal?.output?.json ?? null;
      aggregates.push(json);
      this.emit({ type: 'loop_item', runId: this.runId, nodeId: node.id, index: i, total: limited.length, output: json, status: 'success' });
    }

    return {
      output: { json: { count: aggregates.length, results: aggregates }, text: asText(aggregates) },
      handle: 'done',
      logs: [{ level: 'info', message: `Iterated ${aggregates.length} item(s)` }],
    };
  }

  async runLoopBody({ region, entries, scope }) {
    const bodyInside = [...region.body];
    const before = new Map(this.results);
    const localState = await this.runSegment({ nodeIds: bodyInside, entries, scope });
    const produced = new Map();
    for (const id of bodyInside) {
      const result = this.results.get(id);
      if (result && (localState.get(id) === 'done' || localState.get(id) === 'failed')) produced.set(id, result);
    }
    // Restore the outer node results so iterations don't overwrite each other.
    this.results = new Map([...before, ...produced]);
    return produced;
  }

  pickTerminalOutput(region, produced) {
    const ends = [...region.loopEnds].filter((id) => produced.has(id));
    if (ends.length) return produced.get(ends[0]);
    const terminals = [...region.body].filter((id) => produced.has(id) && !this.outgoingEdges(id).some((e) => region.body.has(e.target)));
    return terminals.length ? produced.get(terminals[terminals.length - 1]) : null;
  }

  /* ---------- node handlers ---------- */

  get handlers() {
    return {
      'trigger.manual': (config, scope) => ({ output: { json: scope.input, text: asText(scope.input) } }),
      'trigger.schedule': (config, scope) => ({ output: { json: scope.trigger.input, text: asText(scope.trigger.input) } }),
      'trigger.webhook': (config, scope) => ({ output: { json: scope.trigger.input, text: asText(scope.trigger.input) } }),

      'core.js': async (config, scope) => {
        if (!config.code) throw new Error('JavaScript node has no code.');
        const { result, logs } = await runJavaScript(config.code, {
          input: scope.input,
          nodes: scope.nodes,
          steps: scope.steps,
          trigger: scope.trigger,
          vars: scope.vars,
          item: scope.item,
          index: scope.index,
        }, { timeoutMs: (Number(config.timeoutSeconds) || 30) * 1000 });
        return { output: { json: result ?? null, text: asText(result) }, logs };
      },

      'core.python': async (config, scope) => {
        if (!config.code) throw new Error('Python node has no code.');
        const { result, logs } = await runPython(config.code, {
          input: scope.input,
          nodes: scope.nodes,
          steps: scope.steps,
          trigger: scope.trigger,
          vars: scope.vars,
          item: scope.item,
          index: scope.index,
        }, { timeoutMs: (Number(config.timeoutSeconds) || 30) * 1000 });
        return { output: { json: result ?? null, text: asText(result) }, logs };
      },

      'core.http': async (config) => {
        const result = await httpRequest({
          method: config.method,
          url: config.url,
          headers: safeJson(config.headers, {}),
          query: safeJson(config.query, {}),
          body: config.body,
          bodyType: config.bodyType,
          timeoutMs: (Number(config.timeoutSeconds) || 30) * 1000,
          credentialId: config.credentialId,
        });
        return {
          output: { json: result, text: asText(result) },
          logs: [{ level: result.ok ? 'info' : 'warn', message: `${config.method || 'GET'} ${result.url} → ${result.status}` }],
        };
      },

      'core.condition': (config, scope) => {
        const value = config.expression ? evaluate(config.expression, scope) : false;
        const branch = value ? 'true' : 'false';
        // Pass the incoming data through so both branches keep working with it.
        const base = scope.input;
        const merged = base && typeof base === 'object' && !Array.isArray(base)
          ? { ...base, condition: { result: value, branch } }
          : { value: base, condition: { result: value, branch } };
        return { output: { json: merged, text: asText(merged) }, handle: branch };
      },

      'core.transform': (config, scope) => {
        if (!config.expression) throw new Error('Transform node needs an expression.');
        const value = evaluate(config.expression, scope);
        return { output: { json: value ?? null, text: asText(value) } };
      },

      'core.loopEnd': (config, scope) => ({ output: { json: scope.input ?? null, text: asText(scope.input) } }),

      'core.delay': async (config) => {
        const seconds = Math.min(Math.max(Number(config.seconds) || 0, 0), 600);
        await sleep(seconds * 1000, this.state);
        return { output: { json: { waitedSeconds: seconds }, text: `waited ${seconds}s` } };
      },

      'core.workflow': async (config, scope) => {
        if (!config.workflowId) throw new Error('Run workflow node has no workflow selected.');
        if (!this.runWorkflow) throw new Error('Sub-workflows cannot run in this context.');
        const payload = !config.payload ? scope.input : (typeof config.payload === 'string' ? safeJson(config.payload, scope.input) : config.payload);
        const res = await this.runWorkflow(config.workflowId, payload, { parentRunId: this.runId, depth: this.depth + 1 });
        return {
          output: { json: res.output ?? null, text: asText(res.output) },
          logs: [{ level: res.status === 'success' ? 'info' : 'warn', message: `Sub-workflow ${res.workflowName || config.workflowId} → ${res.status}` }],
        };
      },

      'browser.action': async (config) => {
        const value = await runBrowserAction(config, { runId: this.runId });
        return {
          output: { json: value, text: asText(value) },
          logs: [{ level: 'info', message: `Browser ${config.action || 'goto'}${config.selector ? ` ${config.selector}` : ''}` }],
        };
      },

      'desktop.action': async (config) => {
        const value = await runDesktopAction({ ...config, runId: this.runId });
        return { output: { json: value, text: asText(value) }, logs: [{ level: 'info', message: `Desktop ${config.action}` }] };
      },

      'integration.http': async (config) => {
        const result = await httpRequest({
          method: config.method || 'POST',
          url: config.path || '/',
          headers: safeJson(config.headers, {}),
          body: config.body,
          bodyType: config.body == null || config.body === '' ? 'none' : 'json',
          credentialId: config.credentialId,
        });
        return {
          output: { json: result, text: asText(result) },
          logs: [{ level: result.ok ? 'info' : 'warn', message: `${config.method || 'POST'} ${result.url} → ${result.status}` }],
        };
      },

      'integration.slack': async (config) => {
        const url = getCredential(config.credentialId)?.data?.webhookUrl;
        if (!url) throw new Error('Pick a Slack webhook connection first.');
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: String(config.text ?? '') }) });
        if (!res.ok) throw new Error(`Slack returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return { output: { json: { sent: true, channel: 'slack' }, text: 'message sent' } };
      },

      'integration.discord': async (config) => {
        const url = getCredential(config.credentialId)?.data?.webhookUrl;
        if (!url) throw new Error('Pick a Discord webhook connection first.');
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: String(config.text ?? '') }) });
        if (!res.ok) throw new Error(`Discord returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return { output: { json: { sent: true, channel: 'discord' }, text: 'message sent' } };
      },

      'integration.email': async (config) => {
        const cred = getCredential(config.credentialId);
        if (!cred?.data?.host) throw new Error('Pick an SMTP connection first.');
        const transport = nodemailer.createTransport({
          host: cred.data.host,
          port: Number(cred.data.port) || 587,
          secure: Boolean(cred.data.secure),
          auth: cred.data.user ? { user: cred.data.user, pass: cred.data.pass } : undefined,
        });
        const info = await transport.sendMail({
          from: cred.data.from || cred.data.user,
          to: config.to,
          subject: config.subject || 'Cascade workflow',
          text: String(config.text ?? ''),
        });
        return { output: { json: { sent: true, messageId: info.messageId, to: config.to }, text: `email sent to ${config.to}` } };
      },

      'ai.prompt': async (config, scope) => {
        const prompt = [config.prompt || '', config.includeInput ? `\n\n---\nWorkflow data (JSON):\n${asText(scope.input).slice(0, 12000)}` : ''].join('');
        const res = await callLLM({
          credentialId: config.credentialId,
          system: config.system,
          prompt,
          maxTokens: config.maxTokens,
          temperature: config.temperature,
        });
        return {
          output: { json: { text: res.text, model: res.model, usage: res.usage }, text: res.text },
          logs: [{ level: 'info', message: `AI responded (${res.model})` }],
        };
      },
    };
  }
}

export async function executeWorkflow(options) {
  return new Executor(options).run();
}
