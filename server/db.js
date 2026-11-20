import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';

const db = new DatabaseSync(path.join(DATA_DIR, 'cascade.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    graph TEXT NOT NULL,
    cron TEXT,
    timezone TEXT DEFAULT 'UTC',
    enabled INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT,
    workflow_name TEXT,
    status TEXT NOT NULL,
    trigger TEXT NOT NULL,
    input TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS run_nodes (
    run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    node_type TEXT,
    node_label TEXT,
    iteration INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    duration_ms INTEGER,
    output TEXT,
    error TEXT,
    PRIMARY KEY (run_id, node_id, iteration)
  );

  CREATE TABLE IF NOT EXISTS run_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    node_id TEXT,
    level TEXT,
    message TEXT,
    ts TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_runs_workflow ON runs(workflow_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_run_logs_run ON run_logs(run_id, id);
  CREATE INDEX IF NOT EXISTS idx_run_nodes_run ON run_nodes(run_id);
`);

export const nowIso = () => new Date().toISOString();

export function jsonParse(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default db;
