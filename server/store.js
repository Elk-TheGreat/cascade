import crypto from 'node:crypto';
import db, { jsonParse, nowIso } from './db.js';
import { normalizeGraph, validateGraph } from './graph.js';

const rowToWorkflow = (row, { full = true } = {}) => {
  if (!row) return null;
  const graph = jsonParse(row.graph, { nodes: [], edges: [] });
  const base = {
    id: row.id, name: row.name, description: row.description,
    cron: row.cron, timezone: row.timezone, enabled: Boolean(row.enabled),
    created_at: row.created_at, updated_at: row.updated_at,
  };
  if (!full) return { ...base, node_count: graph.nodes?.length || 0 };
  return { ...base, graph };
};

export function listWorkflows() {
  return db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC').all().map((row) => rowToWorkflow(row, { full: false }));
}

export function getWorkflow(id) {
  return rowToWorkflow(db.prepare('SELECT * FROM workflows WHERE id = ?').get(id));
}

export function createWorkflow({ name, description = '', graph = { nodes: [], edges: [] }, cron = null, timezone = 'UTC', enabled = false }) {
  const normalized = normalizeGraph(graph);
  const validation = validateGraph(normalized);
  if (validation.errors.length) throw new Error(validation.errors[0]);
  const id = crypto.randomUUID();
  const ts = nowIso();
  db.prepare(`INSERT INTO workflows (id, name, description, graph, cron, timezone, enabled, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, name || 'Untitled workflow', description, JSON.stringify(normalized), cron, timezone || 'UTC', enabled ? 1 : 0, ts, ts);
  return { workflow: getWorkflow(id), warnings: validation.warnings };
}

export function updateWorkflow(id, patch) {
  const existing = getWorkflow(id);
  if (!existing) return null;
  let graph = existing.graph;
  if (patch.graph) {
    graph = normalizeGraph(patch.graph);
    const validation = validateGraph(graph);
    if (validation.errors.length) throw new Error(validation.errors[0]);
  }
  const ts = nowIso();
  db.prepare(`UPDATE workflows SET name = ?, description = ?, graph = ?, cron = ?, timezone = ?, enabled = ?, updated_at = ? WHERE id = ?`)
    .run(
      patch.name ?? existing.name,
      patch.description ?? existing.description,
      JSON.stringify(graph),
      patch.cron !== undefined ? patch.cron : existing.cron,
      patch.timezone ?? existing.timezone,
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
      ts, id,
    );
  return { workflow: getWorkflow(id), warnings: validateGraph(graph).warnings };
}

export function deleteWorkflow(id) {
  const workflow = getWorkflow(id);
  if (!workflow) return null;
  db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  return workflow;
}

export function createRunRow({ id, workflowId, workflowName, trigger, input }) {
  db.prepare('INSERT INTO runs (id, workflow_id, workflow_name, status, trigger, input, started_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, workflowId, workflowName, 'running', trigger, JSON.stringify(input ?? null), nowIso());
}

export function finishRunRow({ id, status, error, durationMs }) {
  db.prepare('UPDATE runs SET status = ?, error = ?, finished_at = ?, duration_ms = ? WHERE id = ?')
    .run(status, error || null, nowIso(), durationMs ?? null, id);
}

export function upsertRunNode(event) {
  const iteration = Number(event.iteration) || 0;
  db.prepare(`INSERT INTO run_nodes (run_id, node_id, node_type, node_label, iteration, status, started_at, finished_at, duration_ms, output, error)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(run_id, node_id, iteration) DO UPDATE SET
      status = excluded.status, finished_at = excluded.finished_at, duration_ms = excluded.duration_ms,
      output = excluded.output, error = excluded.error, node_label = excluded.node_label`)
    .run(
      event.runId, event.nodeId, event.nodeType || null, event.label || null, iteration,
      event.status || 'running', event.startedAt || null, event.finishedAt || null,
      event.durationMs ?? null,
      event.output !== undefined ? JSON.stringify(event.output) : null,
      event.error || null,
    );
}

export function insertRunLog(event) {
  db.prepare('INSERT INTO run_logs (run_id, node_id, level, message, ts) VALUES (?,?,?,?,?)')
    .run(event.runId, event.nodeId || null, event.level || 'info', String(event.message ?? ''), event.ts || nowIso());
}

export function listRuns({ workflowId, limit = 40 } = {}) {
  const sql = workflowId
    ? 'SELECT * FROM runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?'
    : 'SELECT * FROM runs ORDER BY started_at DESC LIMIT ?';
  const rows = workflowId ? db.prepare(sql).all(workflowId, limit) : db.prepare(sql).all(limit);
  return rows.map((r) => ({ ...r, input: jsonParse(r.input, null) }));
}

export function getRun(id) {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
  if (!run) return null;
  const nodes = db.prepare('SELECT * FROM run_nodes WHERE run_id = ? ORDER BY started_at ASC').all(id)
    .map((n) => ({ ...n, output: jsonParse(n.output, null) }));
  const logs = db.prepare('SELECT * FROM run_logs WHERE run_id = ? ORDER BY id ASC').all(id);
  return { ...run, input: jsonParse(run.input, null), nodes, logs };
}

export function countRuns() {
  return db.prepare('SELECT COUNT(*) AS c FROM runs').get().c;
}
