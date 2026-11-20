import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Workflow, History, CalendarClock, KeyRound, Sparkles, MonitorSmartphone, X } from 'lucide-react';
import { api } from './api.js';
import WorkflowsPage from './pages/WorkflowsPage.jsx';
import RunsPage from './pages/RunsPage.jsx';
import SchedulesPage from './pages/SchedulesPage.jsx';
import ConnectionsPage from './pages/ConnectionsPage.jsx';
import Editor from './components/Editor.jsx';
import AiDialog from './components/AiDialog.jsx';

const NAV = [
  { id: 'workflows', label: 'Workflows', icon: Workflow, href: '#/workflows' },
  { id: 'runs', label: 'Runs', icon: History, href: '#/runs' },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock, href: '#/schedules' },
  { id: 'connections', label: 'Connections', icon: KeyRound, href: '#/connections' },
];

function parseRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [name = 'workflows', id] = raw.split('/');
  return { name: name || 'workflows', id: id || null };
}

export default function App() {
  const [route, setRoute] = useState(parseRoute);
  const [meta, setMeta] = useState(null);
  const [workflows, setWorkflows] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [toast, setToast] = useState(null);
  const [autorun, setAutorun] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((message, level = 'info') => {
    setToast({ message, level, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const refreshWorkflows = useCallback(async () => {
    try { setWorkflows(await api.workflows()); } catch (err) { notify(err.message, 'error'); }
  }, [notify]);

  const refreshCredentials = useCallback(async () => {
    try { setCredentials(await api.credentials()); } catch { /* connections are optional */ }
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const info = await api.meta();
      setMeta(info);
    } catch (err) {
      notify(err.message, 'error');
    }
    refreshWorkflows();
    refreshCredentials();
  }, [notify, refreshWorkflows, refreshCredentials]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.location.hash = '#/workflows';
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (hash) => {
    if (window.location.hash === hash) setRoute(parseRoute());
    else window.location.hash = hash;
  };

  const openWorkflow = (id) => navigate(`#/workflows/${id}`);

  const runWorkflow = async (wf) => {
    try {
      const { runId } = await api.run(wf.id, { input: {} });
      setAutorun({ workflowId: wf.id, runId, at: Date.now() });
      navigate(`#/workflows/${wf.id}`);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const applyGenerated = async (result) => {
    if (route.name === 'workflows' && route.id) {
      setAiResult(result);
      notify('Draft loaded onto the canvas — review, then save.', 'success');
      return;
    }
    try {
      const { workflow } = await api.createWorkflow({
        name: result.name || 'Generated workflow',
        description: result.description || '',
        graph: result.graph,
      });
      await refreshWorkflows();
      openWorkflow(workflow.id);
      notify('Workflow created from your description.', 'success');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const activeRuns = meta?.activeRuns ?? 0;
  const navKey = route.name === 'workflows' && route.id ? 'workflows' : route.name;

  const shared = useMemo(() => ({ workflows, meta, credentials, toast: notify }), [workflows, meta, credentials, notify]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C</div>
          <div>
            <div className="brand-name">Cascade</div>
            <div className="brand-sub">automation studio</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <a key={item.id} className={`nav-item ${navKey === item.id ? 'active' : ''}`} href={item.href}>
              <item.icon size={14} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.id === 'runs' && activeRuns > 0 && <span className="nav-count">{activeRuns}</span>}
            </a>
          ))}
        </nav>

        <div className="sidebar-block">
          <button className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => setAiOpen(true)}>
            <Sparkles size={13} /> Generate workflow
          </button>
        </div>

        <div className="sidebar-foot">
          <div className="status-row">
            <span className={`status-dot ${meta?.ai?.available ? 'on' : 'warn'}`} />
            <span>{meta?.ai?.available ? `Model: ${meta.ai.model || 'connected'}` : 'AI: built-in planner'}</span>
          </div>
          <div className="status-row">
            <MonitorSmartphone size={11} />
            <span>{meta?.desktop?.supported ? 'Desktop control ready' : 'Desktop control unavailable'}</span>
          </div>
          <div className="status-row faint">
            <span>Cascade v{meta?.version || '1.0.0'} · local</span>
          </div>
        </div>
      </aside>

      <main className="main">
        {route.name === 'workflows' && !route.id && (
          <WorkflowsPage
            {...shared}
            onOpen={openWorkflow}
            onRefresh={refreshWorkflows}
            onGenerate={() => setAiOpen(true)}
            onRun={runWorkflow}
          />
        )}
        {route.name === 'workflows' && route.id && (
          <Editor
            workflowId={route.id}
            meta={meta}
            credentials={credentials}
            workflows={workflows}
            onBack={() => navigate('#/workflows')}
            onSaved={refreshWorkflows}
            toast={notify}
            onOpenAi={() => setAiOpen(true)}
            aiResult={aiResult}
            clearAiResult={() => setAiResult(null)}
            autoRun={autorun?.workflowId === route.id ? autorun : null}
          />
        )}
        {route.name === 'runs' && <RunsPage workflows={workflows} onOpenRun={(id) => openWorkflow(id)} />}
        {route.name === 'schedules' && (
          <SchedulesPage
            onOpenWorkflow={openWorkflow}
            onRunWorkflow={runWorkflow}
            toast={notify}
          />
        )}
        {route.name === 'connections' && (
          <ConnectionsPage
            credentialTypes={meta?.credentialTypes || []}
            onRefresh={() => { refreshCredentials(); bootstrap(); }}
            toast={notify}
          />
        )}
      </main>

      <AiDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onApply={applyGenerated}
        catalog={meta?.catalog || []}
        aiStatus={meta?.ai}
      />

      {toast && (
        <div className={`toast ${toast.level}`}>
          <span>{toast.message}</span>
          <button className="btn icon ghost small" onClick={() => setToast(null)}><X size={12} /></button>
        </div>
      )}
    </div>
  );
}
