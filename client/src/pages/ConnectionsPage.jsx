import { useEffect, useState } from 'react';
import { Plus, Trash2, KeyRound, X, ShieldCheck } from 'lucide-react';
import { api, timeAgo } from '../api.js';
import { NodeIcon } from '../icons.jsx';

function CredentialForm({ types, onClose, onSaved, toast }) {
  const [type, setType] = useState(types[0]?.type || 'http');
  const [name, setName] = useState('');
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const def = types.find((t) => t.type === type);

  const set = (key, value) => setFields((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setSaving(true);
    try {
      await api.createCredential({ name: name.trim() || (def?.label || type), type, fields });
      toast('Connection saved — secrets are encrypted at rest', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 520 }}>
        <div className="modal-head">
          <div className="node-icon"><KeyRound size={15} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 620 }}>New connection</div>
            <div className="tiny muted">Used by HTTP, AI and integration steps.</div>
          </div>
          <button className="btn icon ghost" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label className="field-label" htmlFor="cred-type">Type</label>
            <select id="cred-type" className="select" value={type} onChange={(e) => { setType(e.target.value); setFields({}); }}>
              {types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="cred-name">Name</label>
            <input
              id="cred-name"
              className="input"
              placeholder={def?.label || 'My connection'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {(def?.fields || []).map((field) => {
            const visible = !field.showIf || (
              field.showIf.in ? field.showIf.in.includes(fields[field.showIf.key] ?? field.default) : !field.showIf.notIn?.includes(fields[field.showIf.key])
            );
            if (!visible) return null;
            const value = fields[field.key] ?? '';
            return (
              <div className="field" key={field.key}>
                <label className="field-label" htmlFor={`cred-${field.key}`}>{field.label}</label>
                {field.type === 'select' ? (
                  <select
                    id={`cred-${field.key}`}
                    className="select"
                    value={value || field.default || ''}
                    onChange={(e) => set(field.key, e.target.value)}
                  >
                    {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : field.type === 'secret' ? (
                  <input
                    id={`cred-${field.key}`}
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={value}
                    onChange={(e) => set(field.key, e.target.value)}
                  />
                ) : field.type === 'textarea' ? (
                  <textarea
                    id={`cred-${field.key}`}
                    className="textarea"
                    rows={3}
                    value={value}
                    onChange={(e) => set(field.key, e.target.value)}
                  />
                ) : (
                  <input
                    id={`cred-${field.key}`}
                    className="input"
                    placeholder={field.placeholder}
                    value={value}
                    onChange={(e) => set(field.key, e.target.value)}
                  />
                )}
              </div>
            );
          })}

          <div className="note" style={{ margin: 0 }}>
            <ShieldCheck size={12} /> Values are sealed with AES-256-GCM. The API only ever returns masked secrets.
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save connection'}</button>
        </div>
      </div>
    </div>
  );
}

export default function ConnectionsPage({ credentialTypes, onRefresh, toast }) {
  const [credentials, setCredentials] = useState([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setCredentials(await api.credentials());
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const remove = async (cred) => {
    if (!window.confirm(`Delete the “${cred.name}” connection? Steps using it will fail until replaced.`)) return;
    try {
      await api.deleteCredential(cred.id);
      toast('Connection deleted', 'success');
      load();
      onRefresh?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (loading) return <div className="page"><div className="muted">Loading connections…</div></div>;

  return (
    <div className="page scroll">
      <div className="page-head">
        <div>
          <h1>Connections</h1>
          <p>Credentials and endpoints shared across your workflows.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={14} /> New connection</button>
      </div>

      {credentials.length === 0 ? (
        <div className="empty">
          <KeyRound size={20} color="#5c665e" />
          <h3>No connections yet</h3>
          <p>Add an HTTP token, an OpenAI-compatible key, or SMTP details for email steps.</p>
          <button className="btn primary" onClick={() => setCreating(true)}><Plus size={13} /> Add your first connection</button>
        </div>
      ) : (
        <div className="cred-grid">
          {credentials.map((cred) => {
            const type = credentialTypes.find((t) => t.type === cred.type);
            return (
              <article key={cred.id} className="cred-card">
                <div className="row" style={{ gap: 8 }}>
                  <span className="palette-icon"><NodeIcon name={type?.icon || 'plug'} size={13} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{cred.name}</div>
                    <div className="tiny faint mono">{type?.label || cred.type}</div>
                  </div>
                  <button className="btn icon ghost small" title="Delete" onClick={() => remove(cred)}><Trash2 size={12} /></button>
                </div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {Object.entries(cred.fields || {}).slice(0, 3).map(([key, value]) => (
                    <span key={key} className="cred-chip"><span className="k">{key}</span>{String(value)}</span>
                  ))}
                </div>
                <div className="tiny faint" style={{ marginTop: 10 }}>updated {timeAgo(cred.updated_at)}</div>
              </article>
            );
          })}
        </div>
      )}

      {creating && (
        <CredentialForm
          types={credentialTypes}
          toast={toast}
          onClose={() => setCreating(false)}
          onSaved={() => { load(); onRefresh?.(); }}
        />
      )}
    </div>
  );
}
