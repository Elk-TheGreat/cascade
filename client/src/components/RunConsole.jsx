import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Square, Terminal } from 'lucide-react';
import { duration } from '../api.js';

const STATUS_BADGE = {
  success: 'lime',
  error: 'red',
  running: 'amber',
  skipped: '',
  cancelled: 'red',
};

export default function RunConsole({
  run, logs, steps, collapsed, onToggle, onCancel, onSelectNode, selectedNodeId,
}) {
  const [tab, setTab] = useState('logs');
  const logRef = useRef(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length, run?.status]);

  const status = run?.status || 'idle';

  return (
    <section className={`console ${collapsed ? 'collapsed' : ''}`}>
      <div className="console-head">
        <Terminal size={13} color="#8d968f" />
        <span className="console-title">Run console</span>
        {run && (
          <>
            <span className={`badge ${STATUS_BADGE[status] || ''}`}>{status}</span>
            {run.durationMs != null && <span className="tiny faint mono">{duration(run.durationMs)}</span>}
            <span className="tiny faint mono">run {String(run.runId || '').slice(0, 8)}</span>
          </>
        )}
        {!run && <span className="tiny faint">No run yet — press Run to stream logs here.</span>}
        <div className="grow" />
        {status === 'running' && (
          <button className="btn small danger" onClick={onCancel}><Square size={11} /> Stop</button>
        )}
        <div className="console-tabs">
          <button className={`console-tab ${tab === 'logs' ? 'active' : ''}`} onClick={() => { setTab('logs'); if (collapsed) onToggle(); }}>Logs</button>
          <button className={`console-tab ${tab === 'steps' ? 'active' : ''}`} onClick={() => { setTab('steps'); if (collapsed) onToggle(); }}>Steps</button>
        </div>
        <button className="btn icon ghost small" onClick={onToggle} title={collapsed ? 'Expand console' : 'Collapse console'}>
          {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {!collapsed && (
        <div className="console-body">
          {tab === 'logs' ? (
            <div className="log-view" ref={logRef}>
              {logs.length === 0 && (
                <div className="console-empty" style={{ height: 'auto', padding: 30 }}>
                  Nothing logged yet.
                </div>
              )}
              {logs.map((line, index) => (
                <div key={index} className={`log-line ${line.level || 'info'}`}>
                  <span className="log-time">{new Date(line.ts).toLocaleTimeString()}</span>
                  <span className={`log-level ${line.level || 'info'}`}>{line.level || 'info'}</span>
                  <span className="log-msg">
                    {line.nodeLabel && <span className="log-node">[{line.nodeLabel}] </span>}
                    {line.message}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="log-view" style={{ fontFamily: 'inherit' }}>
              {steps.length === 0 && <div className="console-empty" style={{ height: 'auto', padding: 30 }}>No steps recorded.</div>}
              <div className="step-list" style={{ padding: '0 8px' }}>
                {steps.map((step, index) => (
                  <div
                    key={`${step.nodeId}-${index}`}
                    className={`step-item ${selectedNodeId === step.nodeId ? 'selected' : ''}`}
                    onClick={() => onSelectNode(step.nodeId)}
                  >
                    <span className={`status-dot ${step.status === 'success' ? 'on' : step.status === 'error' ? 'err' : step.status === 'running' ? 'warn' : ''}`} />
                    <span className="name">{step.label || step.nodeId}</span>
                    {step.iteration > 0 && <span className="tiny faint mono">#{step.iteration}</span>}
                    <span className="dur">{step.durationMs != null ? duration(step.durationMs) : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <aside className="console-side">
            <div className="cat-label" style={{ paddingLeft: 0 }}>Run summary</div>
            {run ? (
              <dl className="kv" style={{ gridTemplateColumns: '90px 1fr' }}>
                <dt>Input</dt>
                <dd><pre className="io-pre" style={{ maxHeight: 90 }}>{JSON.stringify(run.input ?? {}, null, 2)}</pre></dd>
                <dt>Steps</dt>
                <dd className="mono tiny">{steps.filter((s) => s.status === 'success').length} ok · {steps.filter((s) => s.status === 'error').length} failed · {steps.filter((s) => s.status === 'skipped').length} skipped</dd>
                {run.error && <>
                  <dt>Error</dt>
                  <dd style={{ color: '#ffb3ab' }}>{run.error}</dd>
                </>}
              </dl>
            ) : (
              <p className="tiny faint" style={{ lineHeight: 1.6 }}>
                Steps show up here as each node starts and finishes. Click one to inspect its output.
              </p>
            )}
            <div className="cat-label" style={{ paddingLeft: 0, marginTop: 12 }}>Shortcuts</div>
            <div className="tiny faint" style={{ lineHeight: 1.8 }}>
              <div><span className="mono">⌘/Ctrl S</span> save</div>
              <div><span className="mono">⌘/Ctrl ↵</span> run</div>
              <div><span className="mono">Backspace</span> delete selection</div>
              <div><span className="mono">⌘/Ctrl D</span> duplicate</div>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
