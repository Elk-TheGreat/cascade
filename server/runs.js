import crypto from 'node:crypto';
import { executeWorkflow, cancelRun } from './engine/executor.js';
import * as store from './store.js';
import { nowIso } from './db.js';

const MAX_DEPTH = 4;
const live = new Map(); // runId -> { subscribers: Set, buffer: [], status }

function broadcast(runId, event) {
  const entry = live.get(runId);
  if (!entry) return;
  entry.buffer.push(event);
  if (process.env.CASCADE_SSE_DEBUG) console.log('[sse]', runId.slice(0,8), event.type, 'subs=' + entry.subscribers.size);
  for (const send of entry.subscribers) {
    try { send(event); } catch (err) { console.log('[sse] send failed', err.message); entry.subscribers.delete(send); }
  }
}

function persist(event) {
  try {
    if (event.type === 'node_start') {
      store.upsertRunNode({ ...event, status: 'running', startedAt: event.ts });
    } else if (event.type === 'node_end') {
      store.upsertRunNode({ ...event, startedAt: event.startedAt, finishedAt: event.ts });
    } else if (event.type === 'log') {
      store.insertRunLog(event);
    }
  } catch (err) {
    console.error('[runs] failed to persist event', event.type, err.message);
  }
}

/** Subscribe to a live run. Returns an unsubscribe function. */
export function subscribe(runId, send, { replayBuffer = true } = {}) {
  const entry = live.get(runId);
  if (!entry) return () => {};
  if (replayBuffer) for (const event of entry.buffer) send(event);
  entry.subscribers.add(send);
  return () => entry.subscribers.delete(send);
}

export function isLive(runId) {
  return live.has(runId);
}

/** Replay a finished (or in-flight) run from the database as SSE-shaped events. */
export function replayFromDb(runId) {
  const run = store.getRun(runId);
  if (!run) return null;
  const events = [{ type: 'run_start', runId, workflowId: run.workflow_id, trigger: run.trigger, input: run.input, startedAt: run.started_at, ts: run.started_at, replay: true }];
  const grouped = new Map();
  for (const node of run.nodes) {
    const key = node.node_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(node);
  }
  for (const [, list] of grouped) {
    for (const node of list) {
      events.push({
        type: 'node_end', runId, nodeId: node.node_id, nodeType: node.node_type, label: node.node_label,
        iteration: node.iteration, status: node.status, durationMs: node.duration_ms,
        output: node.output, error: node.error, startedAt: node.started_at, ts: node.finished_at || node.started_at, replay: true,
      });
    }
  }
  for (const log of run.logs) {
    events.push({ type: 'log', runId, nodeId: log.node_id, level: log.level, message: log.message, ts: log.ts, replay: true });
  }
  events.push({
    type: 'run_end', runId, status: run.status, error: run.error, durationMs: run.duration_ms,
    ts: run.finished_at || nowIso(), replay: true,
  });
  return events;
}

/**
 * Start a run. Returns immediately with the run id; execution continues in the background.
 */
export function startRun({ workflow, input = {}, trigger = 'manual', startNodeId = null, depth = 0 }) {
  const runId = crypto.randomUUID();
  const startedAt = nowIso();
  const startTime = Date.now();
  store.createRunRow({ id: runId, workflowId: workflow.id, workflowName: workflow.name, trigger, input });
  const entry = { subscribers: new Set(), buffer: [], status: 'running', startedAt };
  live.set(runId, entry);

  const emit = (event) => {
    const withRun = { ...event, runId, ts: event.ts || nowIso() };
    if (withRun.type === 'node_start') withRun.startedAt = withRun.ts;
    persist(withRun);
    broadcast(runId, withRun);
  };


  (async () => {
    let status = 'error';
    let error = null;
    try {
      const result = await executeWorkflow({
        runId,
        workflow,
        graph: workflow.graph,
        input,
        trigger,
        startNodeId,
        onEvent: emit,
        depth,
        runWorkflow: (childId, payload, { depth: childDepth }) => {
          const child = store.getWorkflow(childId);
          if (!child) throw new Error('Sub-workflow not found.');
          if (childDepth > MAX_DEPTH) throw new Error('Sub-workflows are nested too deeply.');
          const childRunId = startRun({ workflow: child, input: payload, trigger: 'subflow', depth: childDepth });
          return waitForRun(childRunId);
        },
      });
      status = result.status;
      error = result.error || null;
    } catch (err) {
      status = 'error';
      error = err.message;
    }
    const durationMs = Date.now() - startTime;
    store.finishRunRow({ id: runId, status, error, durationMs });
    entry.status = status;
    broadcast(runId, { type: 'run_end', runId, status, error, durationMs, ts: nowIso() });
    // Keep the buffer around briefly so late SSE clients still get the final state.
    setTimeout(() => live.delete(runId), 120000).unref?.();
  })();

  return runId;
}

/** Wait until a run finishes and return its stored result. */
export function waitForRun(runId, pollMs = 250) {
  return new Promise((resolve) => {
    const tick = () => {
      const run = store.getRun(runId);
      if (run && run.status !== 'running') {
        const nodes = run.nodes || [];
        const last = nodes.length ? nodes[nodes.length - 1] : null;
        resolve({ status: run.status, error: run.error, output: last?.output ?? null, workflowName: run.workflow_name, runId });
      } else {
        setTimeout(tick, pollMs);
      }
    };
    tick();
  });
}

export function stopRun(runId) {
  if (!live.has(runId)) return false;
  cancelRun(runId);
  return true;
}

export function activeRuns() {
  return [...live.entries()].filter(([, e]) => e.status === 'running').map(([id, e]) => ({ id, startedAt: e.startedAt, subscribers: e.subscribers.size }));
}
