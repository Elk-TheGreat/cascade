import vm from 'node:vm';

const HELPERS = `
  const __j = (v) => (v && typeof v === 'object' && 'json' in v ? v.json : v);
  const json = (v) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };
  const text = (v) => (v == null ? '' : typeof v === 'string' ? v : String(__j(v)));
  const number = (v) => Number(__j(v));
  const bool = (v) => Boolean(__j(v));
`;

/** Evaluate a JavaScript expression against a workflow scope. */
export function evaluate(expression, scope = {}, { timeout = 2000 } = {}) {
  const sandbox = vm.createContext({
    ...scope,
    Math, JSON, Date, BigInt, Number, String, Boolean, Array, Object, Map, Set,
    parseInt, parseFloat, isNaN, isFinite, Intl, RegExp, Error, URLSearchParams,
    encodeURIComponent, decodeURIComponent, btoa, atob,
  });
  const code = `(function(){ ${HELPERS} return (${expression}); })()`;
  try {
    return vm.runInContext(code, sandbox, { timeout, filename: 'expression.js' });
  } catch (err) {
    throw new Error(`Expression failed: ${err.message}\n→ ${String(expression).slice(0, 240)}`);
  }
}

const FULL_TEMPLATE = /^\s*\{\{([\s\S]*?)\}\}\s*$/;

/**
 * Render `{{ ... }}` placeholders in any value. A string consisting of a single
 * placeholder returns the raw value, so objects/arrays/numbers keep their type.
 */
export function render(value, scope = {}) {
  if (typeof value === 'string') {
    const single = value.match(FULL_TEMPLATE);
    if (single) return evaluate(single[1], scope);
    if (!value.includes('{{')) return value;
    return value.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => {
      const result = evaluate(expr, scope);
      return result == null ? '' : typeof result === 'object' ? JSON.stringify(result) : String(result);
    });
  }
  if (Array.isArray(value)) return value.map((v) => render(v, scope));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = render(v, scope);
    return out;
  }
  return value;
}

export function hasTemplate(value) {
  return typeof value === 'string' && value.includes('{{');
}
