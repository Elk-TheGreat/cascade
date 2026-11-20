import crypto from 'node:crypto';
import db, { nowIso } from './db.js';
import { seal, unseal } from './secrets.js';
import { CREDENTIAL_MAP } from './engine/catalog.js';

function readData(row) {
  try { return unseal(row.data) || {}; } catch { return {}; }
}

// Only fields the catalog marks as secret are masked; everything else stays readable.
function publicFields(type, data) {
  const def = CREDENTIAL_MAP.get(type);
  const secretKeys = new Set((def?.fields || []).filter((field) => field.type === 'secret').map((field) => field.key));
  const out = { ...data };
  for (const key of Object.keys(out)) {
    if (secretKeys.has(key) && out[key] !== '' && out[key] != null) out[key] = '••••••••';
  }
  return out;
}

export function listCredentials() {
  const rows = db.prepare('SELECT * FROM credentials ORDER BY created_at DESC').all();
  return rows.map((row) => {
    const data = readData(row);
    return {
      id: row.id, name: row.name, type: row.type,
      fields: publicFields(row.type, data),
      created_at: row.created_at, updated_at: row.updated_at,
    };
  });
}

export function getCredential(id) {
  if (!id) return null;
  const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id);
  if (!row) return null;
  return { id: row.id, name: row.name, type: row.type, data: readData(row) };
}

export function publicCredential(id) {
  return listCredentials().find((c) => c.id === id) || null;
}

export function createCredential({ name, type, fields }) {
  if (!name || !type) throw new Error('Credential needs a name and a type.');
  if (!CREDENTIAL_MAP.has(type)) throw new Error(`Unknown credential type "${type}".`);
  const id = crypto.randomUUID();
  const ts = nowIso();
  db.prepare('INSERT INTO credentials (id, name, type, data, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, name, type, seal(fields || {}), ts, ts);
  return getCredential(id);
}

export function updateCredential(id, { name, fields }) {
  const existing = getCredential(id);
  if (!existing) return null;
  const ts = nowIso();
  db.prepare('UPDATE credentials SET name = ?, data = ?, updated_at = ? WHERE id = ?')
    .run(name || existing.name, seal({ ...existing.data, ...(fields || {}) }), ts, id);
  return getCredential(id);
}

export function deleteCredential(id) {
  return db.prepare('DELETE FROM credentials WHERE id = ?').run(id).changes > 0;
}
