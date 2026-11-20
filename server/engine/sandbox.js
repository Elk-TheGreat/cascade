import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const TMP_ROOT = path.join(os.tmpdir(), 'cascade-runs');
fs.mkdirSync(TMP_ROOT, { recursive: true });

function runProcess(command, args, { input, cwd, timeoutMs = 30000, env = {} }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let killedForTimeout = false;
    const timer = setTimeout(() => {
      killedForTimeout = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); if (stdout.length > 4_000_000) stdout = stdout.slice(-4_000_000); });
    child.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(err.message), killedForTimeout }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, killedForTimeout }); });

    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

function makeTmpDir() {
  const dir = path.join(TMP_ROOT, crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const JS_RUNNER = `
import fs from 'node:fs';
const payload = JSON.parse(fs.readFileSync(process.env.CASCADE_IN, 'utf8'));
const logs = [];
const fmt = (a) => a.map((v) => {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}).join(' ');
const console = {
  log: (...a) => logs.push({ level: 'info', message: fmt(a) }),
  info: (...a) => logs.push({ level: 'info', message: fmt(a) }),
  warn: (...a) => logs.push({ level: 'warn', message: fmt(a) }),
  error: (...a) => logs.push({ level: 'error', message: fmt(a) }),
};
const ctx = {
  nodes: payload.nodes || {}, steps: payload.steps || {}, trigger: payload.trigger || {},
  vars: payload.vars || {}, item: payload.item, index: payload.index,
  env: process.env, log: (...a) => console.log(...a),
};
let result;
try {
  const fn = new Function('input', 'ctx', 'console', 'fetch', 'env', \`"use strict"; return (async () => { \${payload.code} \n })();\`);
  result = await fn(payload.input, ctx, console, fetch, process.env);
} catch (err) {
  fs.writeFileSync(process.env.CASCADE_OUT, JSON.stringify({ ok: false, error: err && err.stack ? err.stack : String(err), logs }));
  process.exit(1);
}
let serialised;
try { serialised = JSON.stringify({ ok: true, result, logs }); }
catch (err) { serialised = JSON.stringify({ ok: false, error: 'Result is not JSON-serialisable: ' + err.message, logs }); }
fs.writeFileSync(process.env.CASCADE_OUT, serialised);
`;

const PY_RUNNER = `
import json, os, sys, traceback
payload = json.loads(open(os.environ["CASCADE_IN"], encoding="utf-8").read())
class _Capture:
    def __init__(self): self.parts = []
    def write(self, s): self.parts.append(str(s))
    def flush(self): pass

_capture = _Capture()
_real_stdout = sys.stdout
sys.stdout = _capture
g = {
  "input": payload.get("input"),
  "item": payload.get("item"),
  "index": payload.get("index"),
  "steps": payload.get("steps", {}),
  "ctx": payload.get("ctx", {}),
  "nodes": payload.get("nodes", {}),
  "trigger": payload.get("trigger", {}),
  "vars": payload.get("vars", {}),
  "env": dict(os.environ),
  "result": None,
}
try:
    exec(compile(payload["code"], "<cascade-workflow>", "exec"), g, g)
    out = {"ok": True, "result": g.get("result"), "stdout": _capture.parts and "".join(_capture.parts) or ""}
except Exception:
    out = {"ok": False, "error": traceback.format_exc(), "stdout": _capture.parts and "".join(_capture.parts) or ""}
finally:
    sys.stdout = _real_stdout
open(os.environ["CASCADE_OUT"], "w", encoding="utf-8").write(json.dumps(out, default=str))
`;

/** Execute a JavaScript snippet with a workflow scope. Returns {result, logs}. */
export async function runJavaScript(code, scope, { timeoutMs = 30000 } = {}) {
  const dir = makeTmpDir();
  const inFile = path.join(dir, 'in.json');
  const outFile = path.join(dir, 'out.json');
  const runnerFile = path.join(dir, 'main.mjs');
  fs.writeFileSync(inFile, JSON.stringify({ code, ...scope }));
  fs.writeFileSync(runnerFile, JS_RUNNER);

  const res = await runProcess(process.execPath, ['--max-old-space-size=256', runnerFile], {
    cwd: dir,
    timeoutMs,
    env: { CASCADE_IN: inFile, CASCADE_OUT: outFile, NO_COLOR: '1' },
  });

  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { /* reported below */ }
  fs.rmSync(dir, { recursive: true, force: true });

  if (res.killedForTimeout) throw new Error(`JavaScript timed out after ${Math.round(timeoutMs / 1000)}s`);
  if (!parsed) {
    throw new Error(`JavaScript failed (exit ${res.code}): ${(res.stderr || res.stdout || 'no output').slice(0, 1200)}`);
  }
  if (!parsed.ok) throw new Error(truncate(parsed.error, 3000));
  return { result: parsed.result, logs: parsed.logs || [] };
}

/** Execute a Python snippet with a workflow scope. Returns {result, logs}. */
export async function runPython(code, scope, { timeoutMs = 30000, python = process.env.CASCADE_PYTHON || 'python3' } = {}) {
  const dir = makeTmpDir();
  const inFile = path.join(dir, 'in.json');
  const outFile = path.join(dir, 'out.json');
  const runnerFile = path.join(dir, 'runner.py');
  fs.writeFileSync(inFile, JSON.stringify({ code, ...scope }));
  fs.writeFileSync(runnerFile, PY_RUNNER);

  const res = await runProcess(python, [runnerFile], {
    cwd: dir,
    timeoutMs,
    env: { CASCADE_IN: inFile, CASCADE_OUT: outFile, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
  });

  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { /* reported below */ }
  fs.rmSync(dir, { recursive: true, force: true });

  if (res.killedForTimeout) throw new Error(`Python timed out after ${Math.round(timeoutMs / 1000)}s`);
  if (!parsed) {
    const hint = /ENOENT/.test(res.stderr) ? 'Python 3 is not installed on this machine.' : (res.stderr || res.stdout || 'no output');
    throw new Error(`Python failed (exit ${res.code}): ${truncate(hint, 1200)}`);
  }
  if (!parsed.ok) throw new Error(truncate(parsed.error, 3000));

  const logs = [];
  const captured = String(parsed.stdout || '');
  if (captured.trim()) {
    for (const line of captured.split('\n').slice(-200)) {
      if (line.trim()) logs.push({ level: 'info', message: `[py] ${line}` });
    }
  }
  if (res.stdout.trim()) {
    for (const line of res.stdout.split('\n').slice(-200)) {
      if (line.trim()) logs.push({ level: 'info', message: `[py] ${line}` });
    }
  }
  if (res.stderr.trim()) logs.push({ level: 'warn', message: truncate(`[py] ${res.stderr}`, 2000) });
  return { result: parsed.result, logs };
}

function truncate(str, max) {
  const s = String(str ?? '');
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more characters)` : s;
}
