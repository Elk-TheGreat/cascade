import { useEffect, useState } from 'react';
import { Clock, Play, Check, X, Pencil, CalendarClock } from 'lucide-react';
import { api, timeAgo } from '../api.js';

const PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Weekdays 08:00', cron: '0 8 * * 1-5' },
  { label: 'Daily 09:00', cron: '0 9 * * *' },
  { label: 'Monday 07:00', cron: '0 7 * * 1' },
  { label: 'Every 15 min', cron: '*/15 * * * *' },
];

function ScheduleEditor({ entry, onClose, onSaved, toast }) {
  const [cron, setCron] = useState(entry.cron || '0 9 * * *');
  const [timezone, setTimezone] = useState(entry.timezone || 'UTC');
  const [enabled, setEnabled] = useState(entry.enabled);
  const [valid, setValid] = useState(entry.valid);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!cron.trim()) { setValid(false); return; }
      try {
        const result = await api.validateCron(cron.trim());
        if (!cancelled) setValid(result.valid);
      } catch { if (!cancelled) setValid(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cron]);

  const submit = async () => {
    setSaving(true);
    try {
      await api.setSchedule(entry.id, { cron: cron.trim() || null, timezone, enabled });
      toast(`Schedule saved for “${entry.name}”`, 'success');
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
          <div className="node-icon"><CalendarClock size={15} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 620 }}>{entry.name}</div>
            <div className="tiny muted">Cron schedule in {timezone}</div>
          </div>
          <button className="btn icon ghost" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="field-label" htmlFor="cron">Cron expression</label>
            <input
              id="cron"
              className="input mono"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 9 * * 1-5"
              spellCheck={false}
            />
            <span className="field-hint" style={{ color: valid || !cron.trim() ? undefined : '#ff8b80' }}>
              {!cron.trim() ? 'Leave empty to run only on demand.' : valid ? 'Valid expression · minute hour day month weekday' : 'Not a valid cron expression.'}
            </span>
          </div>

          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {PRESETS.map((preset) => (
              <button key={preset.cron} className="ai-chip" onClick={() => setCron(preset.cron)}>{preset.label}</button>
            ))}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="tz">Timezone</label>
            <input id="tz" className="input mono" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
            <span className="field-hint">IANA name, e.g. Europe/Berlin or America/New_York.</span>
          </div>

          <label className="checkbox">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enable this schedule
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={saving || (!valid && Boolean(cron.trim()))}>
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SchedulesPage({ onOpenWorkflow, onRunWorkflow, toast }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      setEntries(await api.schedules());
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="page"><div className="muted">Loading schedules…</div></div>;

  return (
    <div className="page scroll">
      <div className="page-head">
        <div>
          <h1>Schedules</h1>
          <p>
            {entries.filter((e) => e.running).length} active timers · timezone-aware cron, run in-process.
          </p>
        </div>
        <Clock size={18} color="#5c665e" />
      </div>

      {entries.length === 0 ? (
        <div className="empty"><h3>No workflows to schedule</h3><p>Create a workflow first.</p></div>
      ) : (
        <div className="table">
          <div className="table-head" style={{ gridTemplateColumns: '1.4fr 1fr 1fr 1fr 120px' }}>
            <span>Workflow</span><span>Cron</span><span>Next run</span><span>Last fired</span><span />
          </div>
          {entries.map((entry) => (
            <div key={entry.id} className="table-row" style={{ gridTemplateColumns: '1.4fr 1fr 1fr 1fr 120px' }} onClick={() => onOpenWorkflow(entry.id)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span className={`status-dot ${entry.running ? 'on' : entry.enabled ? 'warn' : ''}`} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
              </span>
              <span className="mono tiny muted">
                {entry.cron || '—'} {entry.cron && !entry.valid && <span className="badge red">invalid</span>}
              </span>
              <span className="tiny muted">{entry.nextRun ? new Date(entry.nextRun).toLocaleString() : '—'}</span>
              <span className="tiny faint">{entry.recent?.[0] ? timeAgo(entry.recent[0].at) : 'never'}</span>
              <span className="row" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                <button className="btn small icon ghost" title="Run now" onClick={() => onRunWorkflow(entry)}><Play size={11} /></button>
                <button className="btn small" onClick={() => setEditing(entry)}><Pencil size={11} /> Edit</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="note">
        <Check size={12} /> Timers are restored from the database at boot. Schedules fire the workflow in the background and
        appear in <strong>Runs</strong> with the <span className="mono">schedule</span> trigger.
      </div>

      {editing && (
        <ScheduleEditor
          entry={editing}
          toast={toast}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
