import { useMemo, useState } from 'react';
import { Plus, Sparkles, Play, Copy, Trash2, Clock, ArrowUpRight, Search, Workflow as WorkflowIcon } from 'lucide-react';
import { api, timeAgo } from '../api.js';

export default function WorkflowsPage({ workflows, onOpen, onRefresh, onGenerate, onRun, toast }) {
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workflows.filter((w) => !q || w.name.toLowerCase().includes(q) || (w.description || '').toLowerCase().includes(q));
  }, [workflows, query]);

  const create = async () => {
    try {
      const result = await api.createWorkflow({
        name: 'Untitled workflow',
        graph: {
          nodes: [{ id: 'start', type: 'trigger.manual', position: { x: 80, y: 160 }, data: { label: 'Manual start' } }],
          edges: [],
        },
      });
      onRefresh?.();
      onOpen(result.workflow.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const duplicate = async (id) => {
    setBusyId(id);
    try {
      const result = await api.duplicateWorkflow(id);
      onRefresh?.();
      toast(`Duplicated as “${result.workflow.name}”`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (wf) => {
    if (!window.confirm(`Delete “${wf.name}”? Its run history stays available in Runs.`)) return;
    setBusyId(wf.id);
    try {
      await api.deleteWorkflow(wf.id);
      onRefresh?.();
      toast('Workflow deleted', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page scroll">
      <div className="page-head">
        <div>
          <h1>Workflows</h1>
          <p>{workflows.length} automations · {workflows.filter((w) => w.enabled && w.cron).length} on a schedule</p>
        </div>
        <div className="row">
          <div className="palette-search" style={{ width: 210 }}>
            <Search size={13} />
            <input className="input" placeholder="Filter workflows…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="btn" onClick={onGenerate}><Sparkles size={13} /> Generate</button>
          <button className="btn primary" onClick={create}><Plus size={14} /> New workflow</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <WorkflowIcon size={22} color="#5c665e" />
          <h3>{workflows.length ? 'No workflow matches that filter' : 'No workflows yet'}</h3>
          <p>{workflows.length ? 'Try a shorter search.' : 'Start from a blank canvas or describe what you want and let the planner draft it.'}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={create}><Plus size={13} /> Blank workflow</button>
            <button className="btn primary" onClick={onGenerate}><Sparkles size={13} /> Generate one</button>
          </div>
        </div>
      ) : (
        <div className="wf-grid">
          {filtered.map((wf) => (
            <article key={wf.id} className="wf-card" onClick={() => onOpen(wf.id)}>
              <div className="wf-card-head">
                <h3>{wf.name}</h3>
                <ArrowUpRight size={14} className="wf-arrow" />
              </div>
              <p className="wf-desc">{wf.description || 'No description yet.'}</p>
              <div className="wf-meta">
                <span className="badge">{wf.node_count} steps</span>
                {wf.cron ? (
                  <span className={`badge ${wf.enabled ? 'blue' : ''}`}><Clock size={10} /> {wf.cron}{wf.enabled ? '' : ' · off'}</span>
                ) : (
                  <span className="badge">manual</span>
                )}
                <span className="tiny faint" style={{ marginLeft: 'auto' }}>{timeAgo(wf.updated_at)}</span>
              </div>
              <div className="wf-actions">
                <button className="btn small" disabled={busyId === wf.id} onClick={(e) => { e.stopPropagation(); onRun(wf); }}>
                  <Play size={11} /> Run
                </button>
                <button className="btn small icon ghost" title="Duplicate" disabled={busyId === wf.id} onClick={(e) => { e.stopPropagation(); duplicate(wf.id); }}>
                  <Copy size={12} />
                </button>
                <button className="btn small icon ghost" title="Delete" disabled={busyId === wf.id} onClick={(e) => { e.stopPropagation(); remove(wf); }}>
                  <Trash2 size={12} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
