import { useEffect, useState } from 'react';
import { RefreshCw, X, AlertTriangle } from 'lucide-react';
import { api, timeAgo, duration } from '../api.js';

const BADGE = { success: 'lime', error: 'red', running: 'amber', cancelled: 'red' };

function RunDetail({ runId, onClose }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('steps');

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const load = async () => {
      try {
        const data = await api.runDetail(runId);
        if (cancelled) return;
        setRun(data);
        if (data.status === 'running') timer = setTimeout(load, 1500);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    };
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [runId]);

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer">
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="crumb">Run · {runId.slice(0, 8)}</div>
            <div style={{ fontWeight: 620, fontSize: 15, marginTop: 4 }}>{run?.workflow_name || 'Loading…'}</div>
          </div>
          {run && <span className={`badge ${BADGE[run.status] || ''}`}>{run.status}</span>}
          <button className="btn icon ghost" onClick={onClose}><X size={14} /></button>
        </div>

        {error && <div className="badge red" style={{ margin: 16 }}>{error}</div>}

        {run && (
          <>
            <div className="drawer-meta">
              <div><span className="tiny faint">Trigger</span><div className="mono tiny">{run.trigger}</div></div>
              <div><span className="tiny faint">Started</span><div className="mono tiny">{new Date(run.started_at).toLocaleString()}</div></div>
              <div><span className="tiny faint">Duration</span><div className="mono tiny">{run.duration_ms != null ? duration(run.duration_ms) : '—'}</div></div>
            </div>
            {run.error && (
              <div className="row" style={{ margin: '0 16px 8px', color: '#ffb3ab', alignItems: 'flex-start' }}>
                <AlertTriangle size={13} style={{ marginTop: 2 }} /> <span className="tiny">{run.error}</span>
              </div>
            )}
            <div className="console-tabs" style={{ padding: '0 16px' }}>
              <button className={`console-tab ${tab === 'steps' ? 'active' : ''}`} onClick={() => setTab('steps')}>Steps ({run.nodes.length})</button>
              <button className={`console-tab ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>Logs ({run.logs.length})</button>
            </div>

            <div className="drawer-body">
              {tab === 'steps' && run.nodes.map((node) => (
                <details key={node.id} className="run-node">
                  <summary>
                    <span className={`status-dot ${node.status === 'success' ? 'on' : node.status === 'error' ? 'err' : 'warn'}`} />
                    <span style={{ flex: 1 }}>{node.label || node.node_id}</span>
                    <span className="tiny faint mono">{node.duration_ms != null ? duration(node.duration_ms) : ''}</span>
                  </summary>
                  <div className="run-node-body">
                    <div className="tiny faint mono">{node.node_type}</div>
                    {node.error && <pre className="io-pre" style={{ color: '#ffb3ab' }}>{node.error}</pre>}
                    {node.output != null && <pre className="io-pre">{JSON.stringify(node.output, null, 2)}</pre>}
                  </div>
                </details>
              ))}
              {tab === 'logs' && (
                <div className="log-view" style={{ height: 'auto', padding: 0 }}>
                  {run.logs.map((line) => (
                    <div key={line.id} className={`log-line ${line.level}`}>
                      <span className="log-time">{new Date(line.ts).toLocaleTimeString()}</span>
                      <span className={`log-level ${line.level}`}>{line.level}</span>
                      <span className="log-msg">{line.message}</span>
                    </div>
                  ))}
                  {!run.logs.length && <div className="tiny faint">No log lines.</div>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function RunsPage({ workflows, onOpenRun }) {
  const [runs, setRuns] = useState([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setRuns(await api.runs({ limit: 60 }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const nameFor = (id) => workflows.find((w) => w.id === id)?.name;
  const filtered = runs.filter((r) => !filter || (r.workflow_name || '').toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="page scroll">
      <div className="page-head">
        <div>
          <h1>Runs</h1>
          <p>Every execution, its steps and its logs.</p>
        </div>
        <div className="row">
          <input
            className="input"
            style={{ width: 220 }}
            placeholder="Filter by workflow…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="btn icon" onClick={load} title="Refresh"><RefreshCw size={13} /></button>
        </div>
      </div>

      {loading ? (
        <div className="muted">Loading runs…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <h3>No runs yet</h3>
          <p>Run a workflow and its steps will show up here, with timings and logs.</p>
        </div>
      ) : (
        <div className="table">
          <div className="table-head">
            <span>Workflow</span><span>Status</span><span>Trigger</span><span>Started</span><span>Duration</span>
          </div>
          {filtered.map((run) => (
            <div key={run.id} className="table-row" onClick={() => setSelected(run.id)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span className={`status-dot ${run.status === 'success' ? 'on' : run.status === 'error' ? 'err' : run.status === 'running' ? 'warn' : ''}`} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {run.workflow_name || nameFor(run.workflow_id) || 'Deleted workflow'}
                </span>
              </span>
              <span><span className={`badge ${BADGE[run.status] || ''}`}>{run.status}</span></span>
              <span className="mono tiny muted">{run.trigger}</span>
              <span className="tiny muted" title={new Date(run.started_at).toLocaleString()}>{timeAgo(run.started_at)}</span>
              <span className="mono tiny muted">{run.duration_ms != null ? duration(run.duration_ms) : run.status === 'running' ? '…' : '—'}</span>
            </div>
          ))}
        </div>
      )}

      {selected && <RunDetail runId={selected} onClose={() => { setSelected(null); load(); }} />}
    </div>
  );
}
