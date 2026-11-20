import { NODE_TYPES, NODE_MAP } from './engine/catalog.js';
import { aiStatus, callLLM } from './engine/ai.js';
import { normalizeGraph, validateGraph } from './graph.js';

const CATALOG_DIGEST = NODE_TYPES.map((n) => ({
  type: n.type,
  label: n.label,
  purpose: n.description,
  outputs: (n.outputs || []).map((o) => o.id),
  fields: (n.fields || []).map((f) => ({ key: f.key, type: f.type, ...(f.default !== undefined ? { default: f.default } : {}), ...(f.options ? { options: f.options } : {}) })),
}));

const SYSTEM = `You are Cascade's workflow architect. You design automation workflows as JSON graphs.
Answer with JSON only, no prose, no markdown fences, matching:
{"name":"...","description":"one sentence","reply":"what you built, 2-3 short sentences","nodes":[{"id":"n1","type":"<catalog type>","data":{...fields...}}],"edges":[{"source":"n1","target":"n2","sourceHandle":null}]}
Rules:
- Start with exactly one trigger node (trigger.manual, trigger.schedule or trigger.webhook).
- Use only these node types: ${NODE_TYPES.map((n) => n.type).join(', ')}.
- Every edge must reference existing node ids. Node ids are short strings like n1, n2.
- Fill node data using the field keys for that node type. Expressions and code can reference input, ctx.nodes, steps, trigger, item, index.
- For each node use the type that genuinely does the job; for slack/discord/email leave credentialId as null.
- Keep graphs between 3 and 8 nodes and wire them in a readable top-to-bottom order.
- Do not invent credentials or secrets.`;

function fallbackReply(prompt) {
  return `Built a starting workflow for: ${prompt.slice(0, 140)}. Review each node, connect the credentials it needs, then run it.`;
}

function extractJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('The model did not return JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function layout(graph) {
  // Simple layered layout: x by distance from the trigger, y stacked per layer.
  const incoming = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) incoming.set(e.target, (incoming.get(e.target) || 0) + 1);
  const depth = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    let changed = false;
    for (const e of graph.edges) {
      const next = Math.min((depth.get(e.source) || 0) + 1, 12);
      if (next > (depth.get(e.target) || 0)) { depth.set(e.target, next); changed = true; }
    }
    if (!changed) break;
  }
  const rows = new Map();
  for (const node of graph.nodes) {
    if (node.position && Number.isFinite(node.position.x) && (node.position.x !== 0 || node.position.y !== 0)) continue;
    const d = depth.get(node.id) || 0;
    const row = rows.get(d) || 0;
    rows.set(d, row + 1);
    node.position = { x: 80 + d * 260, y: 120 + row * 150 };
  }
  return graph;
}

function ensureTrigger(graph) {
  const hasTrigger = graph.nodes.some((n) => NODE_MAP.get(n.type)?.category === 'trigger');
  if (hasTrigger) return graph;
  const roots = graph.nodes.filter((n) => !graph.edges.some((e) => e.target === n.id));
  const trigger = { id: 'trigger', type: 'trigger.manual', data: { label: 'Start', note: '' }, position: { x: 0, y: 120 } };
  graph.nodes.unshift(trigger);
  for (const root of roots) graph.edges.push({ source: trigger.id, target: root.id, sourceHandle: null, targetHandle: null });
  return graph;
}

function labelNodes(graph) {
  for (const node of graph.nodes) {
    if (!node.data.label) node.data.label = NODE_MAP.get(node.type)?.label || node.type;
    if (node.data.credentialId === '') node.data.credentialId = null;
  }
  return graph;
}

export function normalizeGenerated(graph) {
  const normalized = normalizeGraph(ensureTrigger(layout(labelNodes(normalizeGraph(graph)))));
  const validation = validateGraph(normalized);
  return { graph: normalized, warnings: validation.warnings, errors: validation.errors };
}

/* ---------------- local planner (works without an API key) ---------------- */

function cronFromPrompt(prompt) {
  const p = prompt.toLowerCase();
  const time = p.match(/(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  const hour = time ? (Number(time[1]) % 12) + (time[3] === 'pm' ? 12 : 0) : 9;
  const minute = time && time[2] ? Number(time[2]) : 0;
  if (/\b(hourly|every hour)\b/.test(p)) return `${minute} * * * *`;
  if (/\b(every|each)\s+(weekday|day|morning|evening|night)\b|\bdaily\b/.test(p)) {
    const evening = /\bevening\b/.test(p);
    return `${minute} ${evening ? 18 : hour} * * *`;
  }
  if (/\bweekly\b|\bevery week\b/.test(p)) return `${minute} ${hour} * * 1`;
  if (/\b(weekday|business day)s?\b/.test(p)) return `${minute} ${hour} * * 1-5`;
  if (/\bmonday/.test(p)) return `${minute} ${hour} * * 1`;
  if (/\bmonthly\b/.test(p)) return `${minute} ${hour} 1 * *`;
  return `${minute} ${hour} * * *`;
}

function guessUrl(prompt) {
  const match = prompt.match(/https?:\/\/[^\s"'<>)]+/);
  return match ? match[0].replace(/[.,;]$/, '') : null;
}

function detectNotify(prompt) {
  const p = prompt.toLowerCase();
  if (/\bemail|e-mail|inbox|send.*mail\b/.test(p)) return 'integration.email';
  if (/\bslack\b/.test(p)) return 'integration.slack';
  if (/\bdiscord\b/.test(p)) return 'integration.discord';
  return null;
}

/** Deterministic planner used when no model is configured. */
export function planLocally(prompt) {
  const p = prompt.toLowerCase();
  const url = guessUrl(prompt);
  const nodes = [];
  const edges = [];
  let i = 0;
  const add = (type, data) => {
    i += 1;
    const node = { id: `n${i}`, type, data: { label: NODE_MAP.get(type)?.label || type, ...data }, position: { x: 80 + (i - 1) * 260, y: 120 } };
    nodes.push(node);
    if (i > 1) edges.push({ id: `e${i - 1}`, source: `n${i - 1}`, target: node.id, sourceHandle: null, targetHandle: null });
    return node;
  };

  const wantSchedule = /\b(every|daily|hourly|weekly|schedule|cron|each morning|at \d)\b/.test(p);
  const wantWebhook = /\bwebhook|when (?:a|an|someone|something) (?:request|posts?)|\btriggered by an http\b/.test(p);
  if (wantSchedule && !wantWebhook) {
    add('trigger.schedule', { cron: cronFromPrompt(prompt), timezone: 'UTC', enabled: true });
  } else if (wantWebhook) {
    add('trigger.webhook', { path: 'my-hook' });
  } else {
    add('trigger.manual', { note: '' });
  }

  const wantsScrape = /\b(scrape|crawl|website|page|html|article|screenshot)\b/.test(p) && !/\bapi\b/.test(p);
  if (url) {
    if (wantsScrape || /\bscreenshot\b/.test(p)) {
      add('browser.action', { action: 'goto', url, selector: '', value: '' });
      if (/\bscreenshot\b/.test(p)) add('browser.action', { action: 'screenshot', fullPage: true, width: 1280, height: 800 });
      else add('browser.action', { action: 'extractText', selector: 'body' });
    } else {
      add('core.http', { method: 'GET', url, headers: '{}', query: '{}', bodyType: 'none', parse: 'auto', timeoutSeconds: 30 });
    }
  } else if (/\b(scrape|crawl|website|page|html|article)\b/.test(p)) {
    add('browser.action', { action: 'goto', url: 'https://example.com', selector: '', value: '' });
    add('browser.action', { action: 'extractText', selector: 'body' });
  }

  if (/\bpython\b/.test(p)) {
    add('core.python', {
      code: 'items = input if isinstance(input, list) else [input]\nresult = [{"index": i, "value": str(v)[:200]} for i, v in enumerate(items)]',
      timeoutSeconds: 30,
    });
  } else if (/\bjavascript|\bjs\b|\bparse|\bextract|\bnormalis|\bnormaliz/.test(p)) {
    add('core.js', {
      code: '// Shape the incoming data so the next steps are simple.\nconst data = Array.isArray(input) ? input : [input];\nreturn data.map((row, i) => ({ index: i, value: row })).slice(0, 50);',
      timeoutSeconds: 30,
    });
  } else if (!nodes[1]) {
    add('core.js', { code: 'return { received: input, at: new Date().toISOString() };', timeoutSeconds: 30 });
  }

  if (/\bsummari|\bai\b|\banaly|\bclassif|\bgpt|\bllm\b|\bwrite\b|\bcaption/.test(p)) {
    add('ai.prompt', {
      credentialId: null,
      system: 'You are a precise automation assistant. Reply with plain text.',
      prompt: 'Work with the workflow data below and answer the task from the request.',
      includeInput: true,
      maxTokens: 800,
      temperature: 0.2,
    });
  }

  if (/\bcondition|\bif\b|\bonly when|\bgreater than|\bmore than |>/.test(p)) {
    const cond = add('core.condition', { expression: 'Boolean(input)' });
    // Branch back: condition passes its output on the "true" handle.
    edges[edges.length - 1].sourceHandle = 'true';
    void cond;
  }

  const notify = detectNotify(prompt);
  if (notify) {
    if (notify === 'integration.email') add(notify, { credentialId: null, to: 'you@example.com', subject: 'Cascade report', text: '{{ input }}' });
    else add(notify, { credentialId: null, text: '{{ input }}' });
  }

  const graph = normalizeGraph({ nodes, edges });
  return {
    name: guessName(prompt),
    description: prompt.slice(0, 180),
    reply: `${fallbackReply(prompt)} No model is connected yet, so this is Cascade's built-in plan — add an OpenAI-compatible connection for richer generation.`,
    graph,
    source: 'planner',
  };
}

function guessName(prompt) {
  const words = prompt.replace(/https?:\/\/\S+/g, '').trim().split(/\s+/).slice(0, 6).join(' ');
  const name = words.replace(/[^\w\s-]/g, '').trim();
  return name ? name[0].toUpperCase() + name.slice(1) : 'Generated workflow';
}

export async function generateWorkflow({ prompt, credentialId = null }) {
  if (!prompt || !String(prompt).trim()) throw new Error('Describe the workflow you want first.');
  const status = aiStatus();
  if (!status.available && !credentialId) return planLocally(String(prompt).trim());

  const text = await callLLM({
    credentialId,
    system: SYSTEM,
    prompt: `Catalog:\n${JSON.stringify(CATALOG_DIGEST)}\n\nBuild this workflow:\n${prompt}`,
    maxTokens: 2200,
    temperature: 0.3,
  });
  let parsed;
  try {
    parsed = extractJson(text.text);
  } catch (err) {
    throw new Error(`The model replied with something that is not a workflow: ${err.message}`);
  }
  const { graph, warnings } = normalizeGenerated({
    nodes: (parsed.nodes || []).map((n) => ({ ...n, data: n.data || {} })),
    edges: parsed.edges || [],
  });
  return {
    name: parsed.name || guessName(prompt),
    description: parsed.description || String(prompt).slice(0, 180),
    reply: parsed.reply || fallbackReply(prompt),
    graph,
    warnings,
    source: 'ai',
  };
}
