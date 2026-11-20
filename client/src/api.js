async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  meta: () => request('/meta'),
  workflows: () => request('/workflows'),
  workflow: (id) => request(`/workflows/${id}`),
  createWorkflow: (body) => request('/workflows', { method: 'POST', body: JSON.stringify(body) }),
  saveWorkflow: (id, body) => request(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteWorkflow: (id) => request(`/workflows/${id}`, { method: 'DELETE' }),
  duplicateWorkflow: (id) => request(`/workflows/${id}/duplicate`, { method: 'POST' }),
  run: (id, body) => request(`/workflows/${id}/run`, { method: 'POST', body: JSON.stringify(body || {}) }),
  runs: (params = {}) => request(`/runs${params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`),
  runDetail: (id) => request(`/runs/${id}`),
  cancelRun: (id) => request(`/runs/${id}/cancel`, { method: 'POST' }),
  credentials: () => request('/credentials'),
  createCredential: (body) => request('/credentials', { method: 'POST', body: JSON.stringify(body) }),
  updateCredential: (id, body) => request(`/credentials/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteCredential: (id) => request(`/credentials/${id}`, { method: 'DELETE' }),
  schedules: () => request('/schedules'),
  setSchedule: (id, body) => request(`/workflows/${id}/schedule`, { method: 'PUT', body: JSON.stringify(body) }),
  validateCron: (cron) => request('/schedules/validate', { method: 'POST', body: JSON.stringify({ cron }) }),
  generate: (prompt) => request('/ai/generate', { method: 'POST', body: JSON.stringify({ prompt }) }),
};

export function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function duration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
