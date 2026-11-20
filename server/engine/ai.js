import { unseal } from '../secrets.js';
import db, { jsonParse } from '../db.js';

const CREDENTIAL_CACHE_MS = 5000;

/** Which LLM is available, if any: credential first, then environment. */
export function aiStatus() {
  const rows = db.prepare("SELECT * FROM credentials WHERE type IN ('openai','anthropic') ORDER BY created_at ASC").all();
  if (rows.length) {
    const row = rows[0];
    const data = jsonParse(unseal(row.data), {});
    return {
      available: Boolean(data.apiKey),
      provider: row.type,
      model: data.model || (row.type === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini'),
      source: `connection:${row.name}`,
      credentialId: row.id,
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { available: true, provider: 'anthropic', model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', source: 'env', credentialId: null };
  }
  if (process.env.OPENAI_API_KEY) {
    return { available: true, provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', source: 'env', credentialId: null };
  }
  return { available: false, provider: null, model: null, source: null, credentialId: null };
}

function resolveProvider(credentialId) {
  if (credentialId) {
    const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(credentialId);
    if (!row) throw new Error('AI connection not found.');
    if (!['openai', 'anthropic'].includes(row.type)) throw new Error('That connection is not an AI provider.');
    const data = jsonParse(unseal(row.data), {});
    if (!data.apiKey) throw new Error('That AI connection has no API key.');
    return {
      provider: row.type,
      apiKey: data.apiKey,
      baseUrl: data.baseUrl || (row.type === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'),
      model: data.model || (row.type === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini'),
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5' };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', model: process.env.OPENAI_MODEL || 'gpt-4o-mini' };
  }
  throw new Error('No AI provider configured. Add an AI connection in Connections, or set OPENAI_API_KEY / ANTHROPIC_API_KEY.');
}

export async function callLLM({ credentialId, system, prompt, maxTokens = 800, temperature = 0.2, timeoutMs = 90000 }) {
  const cfg = resolveProvider(credentialId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (cfg.provider === 'anthropic') {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: Number(maxTokens) || 800,
          temperature: Number(temperature) ?? 0.2,
          system: system || undefined,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${data.error?.message || JSON.stringify(data).slice(0, 400)}`);
      return { text: (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'), model: cfg.model, usage: data.usage };
    }
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: Number(maxTokens) || 800,
        temperature: Number(temperature) ?? 0.2,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message || JSON.stringify(data).slice(0, 400)}`);
    return { text: data.choices?.[0]?.message?.content || '', model: cfg.model, usage: data.usage };
  } finally {
    clearTimeout(timer);
  }
}
