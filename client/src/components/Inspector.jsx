import { X, Trash2, Copy, ExternalLink, CircleDot } from 'lucide-react';
import { NodeIcon } from '../icons.jsx';

function visible(field, data) {
  const rule = field.showIf;
  if (!rule) return true;
  const value = data[rule.key];
  if (rule.in && !rule.in.includes(value)) return false;
  if (rule.notIn && rule.notIn.includes(value)) return false;
  if (rule.equals !== undefined && value !== rule.equals) return false;
  return true;
}

function Field({ field, value, onChange, credentials, workflows, selfId }) {
  const id = `f-${field.key}`;
  const common = { id, value: value ?? '', onChange: (e) => onChange(field.key, e.target.value) };

  if (field.type === 'checkbox') {
    return (
      <label className="checkbox" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value ?? field.default)}
          onChange={(e) => onChange(field.key, e.target.checked)}
        />
        {field.label}
      </label>
    );
  }

  let control;
  switch (field.type) {
    case 'select':
      control = (
        <select className="select" value={value ?? field.default ?? ''} onChange={(e) => onChange(field.key, e.target.value)}>
          {(field.options || []).map((option) => {
            const opt = typeof option === 'string' ? { value: option, label: option } : option;
            return <option key={opt.value} value={opt.value}>{opt.label || opt.value}</option>;
          })}
        </select>
      );
      break;
    case 'number':
      control = (
        <input
          className="input"
          type="number"
          value={value ?? field.default ?? ''}
          onChange={(e) => onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
      break;
    case 'code':
    case 'json':
      control = (
        <textarea
          className="textarea code"
          rows={field.rows || (field.type === 'json' ? 4 : 8)}
          spellCheck={false}
          placeholder={field.placeholder}
          {...common}
        />
      );
      break;
    case 'textarea':
      control = <textarea className="textarea" rows={field.rows || 4} {...common} placeholder={field.placeholder} />;
      break;
    case 'credential':
      control = (
        <select className="select" value={value ?? ''} onChange={(e) => onChange(field.key, e.target.value || null)}>
          <option value="">— no connection —</option>
          {credentials.map((cred) => (
            <option key={cred.id} value={cred.id}>{cred.name} ({cred.type})</option>
          ))}
        </select>
      );
      break;
    case 'workflow':
      control = (
        <select className="select" value={value ?? ''} onChange={(e) => onChange(field.key, e.target.value || null)}>
          <option value="">— pick a workflow —</option>
          {workflows.filter((w) => w.id !== selfId).map((wf) => (
            <option key={wf.id} value={wf.id}>{wf.name}</option>
          ))}
        </select>
      );
      break;
    case 'cron':
      control = (
        <>
          <input className="input mono" placeholder="0 9 * * *" {...common} />
          <span className="field-hint">minute hour day-of-month month day-of-week · UTC unless set below</span>
        </>
      );
      break;
    default:
      control = <input className="input" {...common} placeholder={field.placeholder} />;
  }

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {field.label}
        {field.required && <span className="req">*</span>}
      </label>
      {control}
      {field.help && <span className="field-hint">{field.help}</span>}
    </div>
  );
}

function NodeRunBlock({ run }) {
  if (!run) return null;
  if (run.status === 'running') return <div className="io-block"><div className="row"><CircleDot size={11} color="#f5c451" /> <span className="tiny muted">Running…</span></div></div>;
  return (
    <div className="io-block stack">
      <div className="row">
        <span className={`badge ${run.status === 'success' ? 'lime' : run.status === 'error' ? 'red' : 'amber'}`}>{run.status}</span>
        {run.durationMs != null && <span className="tiny faint mono">{run.durationMs}ms</span>}
      </div>
      {run.error && <pre className="io-pre" style={{ color: '#ffb3ab' }}>{run.error}</pre>}
      {run.output != null && <pre className="io-pre">{JSON.stringify(run.output, null, 2)}</pre>}
    </div>
  );
}

export default function Inspector({ node, def, catalog, credentials, workflows, selfId, onChange, onDelete, onDuplicate, onClose, run }) {
  if (!node) {
    return (
      <aside className="inspector">
        <div className="inspector-head">
          <div>
            <div className="crumb">Inspector</div>
            <div style={{ fontWeight: 600, marginTop: 4 }}>Nothing selected</div>
          </div>
        </div>
        <div className="inspector-body">
          <p className="muted tiny" style={{ lineHeight: 1.6 }}>
            Select a step to edit it. Drag steps from the palette onto the canvas, connect handles to build the path,
            then press <strong>Run</strong> to watch data move through.
          </p>
          <div className="io-block">
            <div className="cat-label" style={{ paddingLeft: 0 }}>Node types</div>
            {catalog.slice(0, 6).map((type) => (
              <div key={type.type} className="row" style={{ padding: '4px 0' }}>
                <span className="palette-icon"><NodeIcon name={type.icon} size={12} /></span>
                <span className="tiny muted">{type.label}</span>
              </div>
            ))}
            <div className="tiny faint" style={{ marginTop: 6 }}>…and {catalog.length - 6} more</div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="node-icon"><NodeIcon name={def?.icon} size={15} /></div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{def?.label || node.type}</div>
          <div className="mono tiny faint">{node.type}</div>
        </div>
        <button className="btn icon ghost" onClick={onClose} title="Close inspector"><X size={14} /></button>
      </div>

      <div className="inspector-body">
        <div className="field">
          <label className="field-label" htmlFor="node-label">Step name</label>
          <input
            id="node-label"
            className="input"
            value={node.data.label || ''}
            placeholder={def?.label}
            onChange={(e) => onChange('label', e.target.value)}
          />
        </div>

        {(def?.fields || []).filter((f) => visible(f, node.data)).map((field) => (
          <Field
            key={field.key}
            field={field}
            value={node.data[field.key]}
            onChange={onChange}
            credentials={credentials}
            workflows={workflows}
            selfId={selfId}
          />
        ))}

        <div className="divider" />
        <NodeRunBlock run={run} />

        {def?.category === 'browser' && (
          <a className="tiny row" href="/files" target="_blank" rel="noreferrer" onClick={(e) => e.preventDefault()}>
            <ExternalLink size={11} /> Screenshots land in /files after a run
          </a>
        )}
      </div>

      <div className="inspector-foot">
        <button className="btn small" onClick={onDuplicate}><Copy size={12} /> Duplicate</button>
        <button className="btn small danger" onClick={onDelete} style={{ marginLeft: 'auto' }}>
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </aside>
  );
}
