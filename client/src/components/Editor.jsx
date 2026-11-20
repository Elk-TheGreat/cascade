import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, addEdge, useReactFlow,
} from '@xyflow/react';
import { ArrowLeft, Save, Play, Sparkles, Square, Clock, AlertTriangle } from 'lucide-react';
import FlowNode from './FlowNode.jsx';
import Palette from './Palette.jsx';
import Inspector from './Inspector.jsx';
import RunConsole from './RunConsole.jsx';
import { api } from '../api.js';

const nodeTypes = { cascade: FlowNode };

// Runtime decoration (catalog definition, run status) must not be persisted with the graph.
const RUNTIME_KEYS = new Set(['catalogType', 'nodeType', 'runStatus', 'durationMs', 'iteration']);
const cleanData = (data = {}) => Object.fromEntries(Object.entries(data).filter(([key]) => !RUNTIME_KEYS.has(key)));
const stripNode = (node) => ({ id: node.id, type: node.type, position: node.position, data: cleanData(node.data) });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `n-${Math.random().toString(16).slice(2)}`);

export default function Editor({ workflowId, meta, credentials, workflows, onBack, onSaved, toast, onOpenAi, aiResult, clearAiResult, autoRun }) {
  const catalog = meta?.catalog || [];
  const catalogMap = useMemo(() => new Map(catalog.map((c) => [c.type, c])), [catalog]);
  const { screenToFlowPosition, fitView, getViewport } = useReactFlow();

  const [workflow, setWorkflow] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState(null);
  const [logs, setLogs] = useState([]);
  const [steps, setSteps] = useState([]);
  const [consoleCollapsed, setConsoleCollapsed] = useState(true);
  const [error, setError] = useState('');
  const esRef = useRef(null);
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  // The log stream can stall behind buffering proxies; polling keeps the console truthful.
  const watchRun = useCallback((runId) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const detail = await api.runDetail(runId);
        setRun((current) => (current?.runId === runId ? {
          ...current,
          status: detail.status,
          error: detail.error,
          durationMs: detail.duration_ms,
          startedAt: detail.started_at || current.startedAt,
          statuses: Object.fromEntries((detail.nodes || []).map((n) => [n.node_id, {
            status: n.status, label: n.label, durationMs: n.duration_ms, output: n.output, error: n.error, iteration: n.iteration || 0,
          }])),
        } : current));
        setSteps((detail.nodes || []).map((n) => ({
          nodeId: n.node_id, label: n.label, status: n.status, durationMs: n.duration_ms, iteration: n.iteration || 0, ts: n.started_at,
        })));
        setLogs((detail.logs || []).map((l) => ({ level: l.level, ts: l.ts, message: l.message, nodeId: l.node_id })));
        if (detail.status !== 'running' && detail.status !== 'queued') {
          stopPolling();
          esRef.current?.close();
          esRef.current = null;
          onSaved?.();
        }
      } catch {
        /* transient; the next tick retries */
      }
    }, 1000);
  }, [stopPolling, onSaved]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.workflow(workflowId);
      setWorkflow(data);
      setName(data.name);
      setDescription(data.description || '');
      setNodes((data.graph?.nodes || []).map((n) => ({ ...n, data: cleanData(n.data) })));
      setEdges((data.graph?.edges || []).map((e) => ({ ...e, type: 'default' })));
      setDirty(false);
      setSelectedId(null);
      setRun(null);
      setLogs([]);
      setSteps([]);
      setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 60);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [workflowId, fitView]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => () => { esRef.current?.close(); stopPolling(); }, [stopPolling]);

  const markDirty = () => setDirty(true);

  const updateNodeData = (id, key, value) => {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, data: { ...node.data, [key]: value } } : node)));
    markDirty();
  };

  const addNode = (type, position) => {
    const def = catalogMap.get(type);
    if (!def) return;
    const data = { label: def.label };
    for (const field of def.fields || []) if (field.default !== undefined) data[field.key] = field.default;
    const id = uid();
    setNodes((current) => [...current, { id, type, position, data }]);
    setSelectedId(id);
    markDirty();
  };

  const onDrop = (event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/cascade-node');
    if (!type) return;
    addNode(type, screenToFlowPosition({ x: event.clientX - 108, y: event.clientY - 30 }));
  };

  const addAtCenter = (type) => {
    const viewport = getViewport();
    const el = document.querySelector('.canvas-wrap');
    const box = el?.getBoundingClientRect();
    const x = box ? (box.width / 2 - viewport.x) / viewport.zoom : 200;
    const y = box ? (box.height / 2 - viewport.y) / viewport.zoom : 200;
    addNode(type, { x, y });
  };

  const onConnect = useCallback((connection) => {
    setEdges((current) => addEdge({ ...connection, id: uid() }, current));
    markDirty();
  }, []);

  const duplicateSelected = useCallback(() => {
    if (!selectedId) return;
    setNodes((current) => {
      const source = current.find((n) => n.id === selectedId);
      if (!source) return current;
      const copy = { ...source, id: uid(), position: { x: source.position.x + 40, y: source.position.y + 60 }, data: { ...source.data } };
      setSelectedId(copy.id);
      return [...current, copy];
    });
    markDirty();
  }, [selectedId]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setNodes((current) => current.filter((n) => n.id !== selectedId));
    setEdges((current) => current.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
    markDirty();
  }, [selectedId]);

  const save = useCallback(async () => {
    if (!workflow || saving) return null;
    setSaving(true);
    try {
      const result = await api.saveWorkflow(workflow.id, {
        name: name.trim() || 'Untitled workflow',
        description,
        graph: { nodes: nodes.map(stripNode), edges: edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({ id, source, target, sourceHandle, targetHandle })) },
      });
      setWorkflow(result.workflow);
      setDirty(false);
      onSaved?.();
      return result;
    } catch (err) {
      toast(err.message, 'error');
      return null;
    } finally {
      setSaving(false);
    }
  }, [workflow, saving, name, description, nodes, edges, onSaved, toast]);

  const startRun = useCallback(async () => {
    if (!workflow) return;
    if (dirty) {
      const result = await save();
      if (!result) return;
    }
    esRef.current?.close();
    stopPolling();
    setLogs([]);
    setSteps([]);
    setConsoleCollapsed(false);
    setSelectedId(null);
    try {
      const { runId } = await api.run(workflow.id, { input: {} });
      setRun({ runId, status: 'running', input: {}, startedAt: new Date().toISOString(), statuses: {} });
      watchRun(runId);
      const es = new EventSource(`/api/runs/${runId}/stream`);
      esRef.current = es;
      es.onmessage = (message) => {
        const event = JSON.parse(message.data);
        if (event.type === 'run_start') {
          setRun((current) => ({ ...(current || {}), runId, status: 'running', input: event.input || {}, startedAt: event.startedAt }));
        } else if (event.type === 'node_start') {
          setRun((current) => ({ ...current, statuses: { ...(current?.statuses || {}), [event.nodeId]: { status: 'running', label: event.label } } }));
          setSteps((current) => [...current, { nodeId: event.nodeId, label: event.label, status: 'running', iteration: event.iteration || 0, ts: event.ts }]);
        } else if (event.type === 'node_end') {
          setRun((current) => ({
            ...current,
            statuses: { ...(current?.statuses || {}), [event.nodeId]: { status: event.status, label: event.label, durationMs: event.durationMs, output: event.output, error: event.error, iteration: event.iteration || 0 } },
          }));
          setSteps((current) => {
            const next = [...current];
            for (let i = next.length - 1; i >= 0; i -= 1) {
              if (next[i].nodeId === event.nodeId && next[i].status === 'running') {
                next[i] = { ...next[i], status: event.status, durationMs: event.durationMs };
                return next;
              }
            }
            return [...next, { nodeId: event.nodeId, label: event.label, status: event.status, durationMs: event.durationMs, iteration: event.iteration || 0, ts: event.ts }];
          });
        } else if (event.type === 'log') {
          setLogs((current) => [...current, event]);
        } else if (event.type === 'loop_item') {
          setLogs((current) => [...current, { level: 'debug', ts: event.ts, message: `iteration ${event.index + 1}/${event.total}` }]);
        } else if (event.type === 'run_end') {
          setRun((current) => ({ ...current, status: event.status, error: event.error, durationMs: event.durationMs }));
          es.close();
          esRef.current = null;
          onSaved?.();
        }
      };
      es.onerror = () => {
        es.close();
        esRef.current = null;
        // Polling keeps the run state accurate, so a dropped stream is not fatal.
      };
    } catch (err) {
      toast(err.message, 'error');
      setRun(null);
    }
  }, [workflow, dirty, save, onSaved, toast, watchRun, stopPolling]);

  const stopRun = async () => {
    if (!run?.runId) return;
    try { await api.cancelRun(run.runId); } catch (err) { toast(err.message, 'error'); }
  };

  useEffect(() => {
    const handler = (event) => {
      const tag = event.target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        startRun();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && !typing) {
        event.preventDefault();
        duplicateSelected();
      } else if ((event.key === 'Backspace' || event.key === 'Delete') && !typing) {
        if (selectedId) { event.preventDefault(); deleteSelected(); }
      } else if (event.key === 'Escape' && !typing) {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save, startRun, duplicateSelected, deleteSelected, selectedId]);

  // Drop an AI-generated graph onto the canvas (replacing it).
  useEffect(() => {
    if (!aiResult) return;
    if (nodes.length > 1 && !window.confirm('Replace the current graph with the generated workflow? Unsaved changes in the editor will be lost.')) {
      clearAiResult?.();
      return;
    }
    setNodes((aiResult.graph.nodes || []).map((n) => ({ ...n, data: { ...n.data } })));
    setEdges((aiResult.graph.edges || []).map((e) => ({ ...e, type: 'default' })));
    if (aiResult.name) setName(aiResult.name);
    setDescription(aiResult.description || '');
    setSelectedId(null);
    setDirty(true);
    toast('Generated workflow loaded — press Save to keep it.', 'success');
    clearAiResult?.();
    setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 60);
  }, [aiResult, clearAiResult, fitView, name]);

  const handleNodesChange = useCallback((changes) => {
    const selected = changes.find((change) => change.type === 'select' && change.selected);
    if (selected) setSelectedId(selected.id);
    else if (changes.some((change) => change.type === 'select')) setSelectedId(null);

    const moved = changes.filter((change) => change.type === 'position' && change.position);
    const removed = changes.filter((change) => change.type === 'remove');
    if (!moved.length && !removed.length) return;

    setNodes((current) => {
      const gone = new Set(removed.map((change) => change.id));
      let next = gone.size ? current.filter((node) => !gone.has(node.id)) : current;
      if (moved.length) {
        const positions = new Map(moved.map((change) => [change.id, change.position]));
        next = next.map((node) => (positions.has(node.id) ? { ...node, position: positions.get(node.id) } : node));
      }
      return next;
    });
    if (removed.length) {
      const gone = new Set(removed.map((change) => change.id));
      setEdges((current) => current.filter((edge) => !gone.has(edge.source) && !gone.has(edge.target)));
    }
    setDirty(true);
  }, []);

  const handleEdgesChange = useCallback((changes) => {
    if (!changes.some((change) => change.type === 'remove')) return;
    const gone = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id));
    setEdges((current) => current.filter((edge) => !gone.has(edge.id)));
    setDirty(true);
  }, []);

  const autoranAt = useRef(null);
  useEffect(() => {
    if (!autoRun || !workflow) return;
    if (autoranAt.current === autoRun.at) return;
    autoranAt.current = autoRun.at;
    startRun();
  }, [autoRun, workflow, startRun]);

  const statuses = run?.statuses || {};

  const rfNodes = useMemo(() => nodes.map((node) => {
    const status = statuses[node.id];
    return {
      ...node,
      type: 'cascade',
      selected: node.id === selectedId,
      data: {
        ...node.data,
        catalogType: catalogMap.get(node.type),
        nodeType: node.type,
        runStatus: status?.status,
        durationMs: status?.durationMs,
        iteration: status?.iteration,
      },
    };
  }), [nodes, statuses, selectedId, catalogMap]);

  const rfEdges = useMemo(() => edges.map((edge) => {
    const status = statuses[edge.source]?.status;
    const color = status === 'success' ? 'rgba(200,247,81,.5)' : status === 'error' ? 'rgba(255,111,97,.6)' : status === 'running' ? '#f5c451' : undefined;
    return { ...edge, type: 'default', animated: status === 'running', style: color ? { stroke: color } : undefined };
  }), [edges, statuses]);

  const selectedNode = nodes.find((n) => n.id === selectedId) || null;
  const trigger = useMemo(() => {
    const node = nodes.find((n) => catalogMap.get(n.type)?.category === 'trigger');
    return node ? catalogMap.get(node.type) : null;
  }, [nodes, catalogMap]);

  if (loading) {
    return <div className="page"><div className="muted">Loading workflow…</div></div>;
  }
  if (error) {
    return (
      <div className="page">
        <div className="empty">
          <AlertTriangle size={20} color="#ff6f61" />
          <h3>Could not open this workflow</h3>
          <p>{error}</p>
          <button className="btn" onClick={onBack}>Back to workflows</button>
        </div>
      </div>
    );
  }

  const schedule = workflow?.cron && workflow?.enabled ? `${workflow.cron} · ${workflow.timezone}` : null;

  return (
    <div className="editor">
      <div className="topbar">
        <button className="btn icon ghost" onClick={onBack} title="Back"><ArrowLeft size={15} /></button>
        <div style={{ minWidth: 0 }}>
          <div className="crumb">Workflow</div>
          <input
            className="title-input"
            value={name}
            onChange={(e) => { setName(e.target.value); markDirty(); }}
            spellCheck={false}
          />
        </div>
        <span className={`saving-dot ${dirty ? 'dirty' : 'saved'}`}>{saving ? 'saving…' : dirty ? 'unsaved' : 'saved'}</span>
        {schedule && <span className="badge blue"><Clock size={10} /> {schedule}</span>}
        {trigger && <span className="badge">{trigger.label}</span>}
        <div className="grow" />
        <button className="btn ghost" onClick={onOpenAi}><Sparkles size={13} /> Generate</button>
        <button className="btn" onClick={save} disabled={saving || !dirty}><Save size={13} /> Save</button>
        {run?.status === 'running' ? (
          <button className="btn danger" onClick={stopRun}><Square size={12} /> Stop</button>
        ) : (
          <button className="btn primary" onClick={startRun}><Play size={13} /> Run</button>
        )}
      </div>

      <div className="editor-body">
        <Palette catalog={catalog} categories={meta?.categories || []} onAdd={addAtCenter} />

        <div
          className="canvas-wrap"
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            defaultEdgeOptions={{ type: 'default' }}
            connectionLineStyle={{ stroke: '#c8f751', strokeWidth: 2 }}
            deleteKeyCode={null}
            minZoom={0.2}
            maxZoom={1.8}
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#222824" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable nodeColor="#2b332d" maskColor="rgba(6,8,7,.72)" position="bottom-right" />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="empty" style={{ position: 'absolute', inset: '30% 25% auto', border: 'none', pointerEvents: 'none' }}>
              <h3>Empty canvas</h3>
              <p>Drag a trigger from the palette to start, or let the AI planner draft it.</p>
            </div>
          )}
        </div>

        <Inspector
          node={selectedNode}
          def={selectedNode ? catalogMap.get(selectedNode.type) : null}
          catalog={catalog}
          credentials={credentials}
          workflows={workflows}
          selfId={workflowId}
          onChange={(key, value) => updateNodeData(selectedId, key, value)}
          onDelete={deleteSelected}
          onDuplicate={duplicateSelected}
          onClose={() => setSelectedId(null)}
          run={statuses[selectedId]}
        />
      </div>

      <RunConsole
        run={run}
        logs={logs}
        steps={steps}
        collapsed={consoleCollapsed}
        onToggle={() => setConsoleCollapsed((v) => !v)}
        onCancel={stopRun}
        onSelectNode={(id) => setSelectedId(id)}
        selectedNodeId={selectedId}
      />
    </div>
  );
}
