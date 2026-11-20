import { unseal } from '../secrets.js';
import db from '../db.js';

const LOCAL_OLLAMA = { baseUrl: 'http://localhost:11434', model: 'llama3.1' };

const DEFAULTS = {
  ollama: LOCAL_OLLAMA,
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
};
const AI_PROVIDERS = Object.keys(DEFAULTS);

const trimUrl = (url) => String(url || '').replace(/\/+$/, '');

function configFromCredential(row) {
  const sealed = unseal(row.data);
  const data = sealed && typeof sealed === 'object' ? sealed : {};
  const fallback = DEFAULTS[row.type] || DEFAULTS.openai;
  return {
    provider: row.type,
    apiKey: data.apiKey || null,
    baseUrl: trimUrl(data.baseUrl || fallback.baseUrl),
    model: data.model || fallback.model,
    source: `connection:${row.name}`,
    credentialId: row.id,
    modelExplicit: Boolean(data.model),
  };
}

function ollamaFromEnv() {
  const baseUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || LOCAL_OLLAMA.baseUrl;
  return {
    provider: 'ollama',
    apiKey: null,
    baseUrl: trimUrl(baseUrl),
    model: process.env.OLLAMA_MODEL || LOCAL_OLLAMA.model,
    source: 'env',
    credentialId: null,
    modelExplicit: Boolean(process.env.OLLAMA_MODEL),
    explicit: Boolean(process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || process.env.OLLAMA_MODEL),
  };
}

/** Credential first, then environment; null when nothing is configured. */
function configuredProvider() {
  const rows = db.prepare("SELECT * FROM credentials WHERE type IN ('ollama','openai','anthropic') ORDER BY created_at ASC").all();
  for (const row of rows) {
    const cfg = configFromCredential(row);
    if (cfg.provider === 'ollama' || cfg.apiKey) return cfg;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, baseUrl: trimUrl(process.env.ANTHROPIC_BASE_URL || DEFAULTS.anthropic.baseUrl), model: process.env.ANTHROPIC_MODEL || DEFAULTS.anthropic.model, source: 'env', credentialId: null };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, baseUrl: trimUrl(process.env.OPENAI_BASE_URL || DEFAULTS.openai.baseUrl), model: process.env.OPENAI_MODEL || DEFAULTS.openai.model, source: 'env', credentialId: null };
  }
  const local = ollamaFromEnv();
  return local.explicit ? local : null;
}

const publicStatus = (cfg) => ({
  available: true,
  provider: cfg.provider,
  model: cfg.model,
  baseUrl: cfg.baseUrl,
  source: cfg.source,
  credentialId: cfg.credentialId,
});

/** Which LLM is configured: credential first, then environment. Synchronous, no network. */
function aiStatus() {
  const cfg = configuredProvider();
  return cfg ? publicStatus(cfg) : { available: false, provider: null, model: null, baseUrl: null, source: null, credentialId: null };
}

async function ollamaModels(baseUrl, timeoutMs = 900) {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return (data.models || []).map((m) => m.name).filter(Boolean);
  } catch {
    return null;
  }
}

/** Like aiStatus(), but also detects an Ollama daemon on the local default address. */
export async function aiStatusAsync() {
  const status = aiStatus();
  if (status.available) return status;
  const local = ollamaFromEnv();
  const models = await ollamaModels(local.baseUrl);
  if (!models?.length) return status;
  return { ...publicStatus({ ...local, source: 'local' }), model: models.includes(local.model) ? local.model : models[0], models };
}

/** With no model configured, use whatever the daemon already has instead of a guess. */
async function pickInstalledModel(cfg) {
  if (cfg.provider !== 'ollama' || cfg.modelExplicit) return cfg;
  const models = await ollamaModels(cfg.baseUrl);
  if (!models?.length || models.includes(cfg.model)) return cfg;
  return { ...cfg, model: models[0] };
}

async function resolveProvider(credentialId) {
  if (credentialId) {
    const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(credentialId);
    if (!row) throw new Error('AI connection not found.');
    if (!AI_PROVIDERS.includes(row.type)) throw new Error('That connection is not an AI provider.');
    const cfg = configFromCredential(row);
    if (cfg.provider !== 'ollama' && !cfg.apiKey) throw new Error('That AI connection has no API key.');
    return pickInstalledModel(cfg);
  }
  return pickInstalledModel(configuredProvider() || ollamaFromEnv());
}

async function postJson(url, body, { signal, headers = {} }) {
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export async function callLLM({ credentialId, system, prompt, maxTokens = 800, temperature = 0.2, timeoutMs = 90000 }) {
  const cfg = await resolveProvider(credentialId);
  // Local models are slow on CPU, so give Ollama a longer leash.
  const budget = cfg.provider === 'ollama' ? Math.max(timeoutMs, 300000) : timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    if (cfg.provider === 'anthropic') {
      const { res, data } = await postJson(`${cfg.baseUrl}/v1/messages`, {
        model: cfg.model,
        max_tokens: num(maxTokens, 800),
        temperature: num(temperature, 0.2),
        system: system || undefined,
        messages: [{ role: 'user', content: prompt }],
      }, { signal: controller.signal, headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' } });
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${data.error?.message || JSON.stringify(data).slice(0, 400)}`);
      return { text: (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'), model: cfg.model, usage: data.usage };
    }

    if (cfg.provider === 'ollama') {
      let res; let data;
      try {
        ({ res, data } = await postJson(`${cfg.baseUrl}/api/chat`, {
          model: cfg.model,
          stream: false,
          options: { temperature: num(temperature, 0.2), num_predict: num(maxTokens, 800) },
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: prompt },
          ],
        }, { signal: controller.signal }));
      } catch (err) {
        if (err.name === 'AbortError') throw new Error(`Ollama at ${cfg.baseUrl} did not answer within ${Math.round(budget / 1000)}s (model: ${cfg.model}).`);
        throw new Error(`Cannot reach Ollama at ${cfg.baseUrl} (${err.cause?.code || err.message}). Start it with \`ollama serve\`, then \`ollama pull ${cfg.model}\`.`);
      }
      if (!res.ok) {
        const hint = res.status === 404 ? ` Pull it first with \`ollama pull ${cfg.model}\`.` : '';
        throw new Error(`Ollama ${res.status}: ${data.error || JSON.stringify(data).slice(0, 400)}.${hint}`);
      }
      return {
        text: data.message?.content || '',
        model: data.model || cfg.model,
        usage: { prompt_tokens: data.prompt_eval_count, completion_tokens: data.eval_count },
      };
    }

    const { res, data } = await postJson(`${cfg.baseUrl}/chat/completions`, {
      model: cfg.model,
      max_tokens: num(maxTokens, 800),
      temperature: num(temperature, 0.2),
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    }, { signal: controller.signal, headers: { authorization: `Bearer ${cfg.apiKey}` } });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message || JSON.stringify(data).slice(0, 400)}`);
    return { text: data.choices?.[0]?.message?.content || '', model: cfg.model, usage: data.usage };
  } finally {
    clearTimeout(timer);
  }
}
