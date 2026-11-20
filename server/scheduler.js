import cron from 'node-cron';
import * as store from './store.js';
import { startRun } from './runs.js';

const tasks = new Map(); // workflowId -> { task, cron, timezone }
const recent = []; // { workflowId, workflowName, at, cron }

function describe(expr) {
  try { return cron.validate(expr) ? expr : null; } catch { return null; }
}

export function scheduledAt(workflow) {
  const node = (workflow.graph?.nodes || []).find((n) => n.type === 'trigger.schedule' && n.data?.cron);
  return (workflow.cron || node?.data?.cron || '').trim() || null;
}

function clear(workflowId) {
  const existing = tasks.get(workflowId);
  if (existing) {
    try { existing.task.stop(); } catch { /* already stopped */ }
    tasks.delete(workflowId);
  }
}

export function syncWorkflow(workflowId) {
  clear(workflowId);
  const workflow = store.getWorkflow(workflowId);
  if (!workflow) return;
  const expr = scheduledAt(workflow);
  if (!expr || !workflow.enabled) return;
  if (!cron.validate(expr)) {
    console.warn(`[scheduler] workflow "${workflow.name}" has an invalid cron expression: ${expr}`);
    return;
  }
  const timezone = workflow.timezone || 'UTC';
  const task = cron.schedule(expr, () => {
    recent.unshift({ workflowId: workflow.id, workflowName: workflow.name, at: new Date().toISOString(), cron: expr });
    if (recent.length > 50) recent.pop();
    startRun({ workflow, input: { scheduledAt: new Date().toISOString(), cron: expr }, trigger: 'schedule' });
  }, { timezone, name: `workflow:${workflow.id}` });
  tasks.set(workflow.id, { task, cron: expr, timezone });
}

export function syncAll() {
  for (const id of [...tasks.keys()]) clear(id);
  for (const wf of store.listWorkflows()) syncWorkflow(wf.id);
}

export function scheduleOverview() {
  return store.listWorkflows().map((wf) => {
    const expr = scheduledAt(wf);
    const active = tasks.get(wf.id);
    return {
      id: wf.id, name: wf.name, enabled: wf.enabled, timezone: wf.timezone,
      cron: expr, valid: expr ? Boolean(describe(expr)) : false, running: Boolean(active),
      nextRun: active ? nextRunTime(active.task) : null,
      recent: recent.filter((r) => r.workflowId === wf.id).slice(0, 5),
    };
  });
}

function nextRunTime(task) {
  try {
    const next = task.getNextRun?.();
    return next ? new Date(next).toISOString() : null;
  } catch { return null; }
}

export function validateCron(expr) {
  try { return cron.validate(String(expr)); } catch { return false; }
}
