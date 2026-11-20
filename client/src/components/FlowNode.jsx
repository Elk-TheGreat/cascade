import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { NodeIcon } from '../icons.jsx';

function summary(node, def) {
  const d = node.data || {};
  switch (d.nodeType || node.type) {
    case 'core.js':
    case 'core.python':
      return (d.code || '').split('\n').find((line) => line.trim()) || 'empty script';
    case 'core.http':
      return `${d.method || 'GET'} ${d.url || 'no URL yet'}`;
    case 'core.condition':
    case 'core.transform':
      return d.expression || 'no expression';
    case 'core.loop':
      return `items: ${d.items || 'input.items'}`;
    case 'core.delay':
      return `${d.seconds ?? 2}s pause`;
    case 'trigger.schedule':
      return d.cron ? `${d.cron} · ${d.timezone || 'UTC'}` : 'no cron set';
    case 'trigger.webhook':
      return d.path ? `/api/hooks/${d.path}` : 'no path set';
    case 'browser.action':
      return `${d.action || 'goto'}${d.url ? ` · ${d.url}` : d.selector ? ` · ${d.selector}` : ''}`;
    case 'desktop.action':
      return `${d.action || 'screenshot'}${d.key ? ` · ${d.key}` : ''}`;
    case 'integration.email':
      return d.to ? `to ${d.to}` : 'no recipient';
    case 'ai.prompt':
      return (d.prompt || '').trim().slice(0, 80) || 'no prompt yet';
    default:
      return def?.description || '';
  }
}

const FlowNode = memo(({ data, type, selected }) => {
  const def = data.catalogType;
  const status = data.runStatus;
  const isLoop = type === 'core.loop';
  const isCondition = type === 'core.condition';
  const outputs = def?.outputs || [{ id: 'main' }];
  const label = data.label || def?.label || type;

  const statusClass = data.runStatus ? `status-${data.runStatus}` : '';
  const statusText = status === 'running' ? 'running' : status === 'success' ? 'done'
    : status === 'error' ? 'failed' : status === 'skipped' ? 'skipped' : '';

  return (
    <div
      className={`node ${selected ? 'selected' : ''} ${statusClass}`}
      data-cat={def?.category || 'core'}
    >
      {def?.inputs?.length > 0 && (
        <Handle type="target" position={Position.Left} className="node-handle" id={def.inputs[0].id || 'main'} />
      )}
      <div className="node-top">
        <div className="node-icon"><NodeIcon name={def?.icon} /></div>
        <div style={{ minWidth: 0 }}>
          <div className="node-name" title={label}>{label}</div>
          <div className="node-kind">{def?.category || 'node'}</div>
        </div>
      </div>
      <div className="node-body">
        <span className="snippet" title={summary({ type, data }, def)}>{summary({ type, data }, def)}</span>
      </div>
      {(statusText || data.iteration > 0) && (
        <div className="node-foot">
          {statusText && <span className={`node-status-label ${statusText}`}>{statusText}</span>}
          {data.durationMs != null && <span className="node-status-label">{data.durationMs}ms</span>}
          {data.iteration > 0 && <span className="node-status-label">#{data.iteration}</span>}
        </div>
      )}
      {outputs.map((out, i) => {
        const total = outputs.length;
        const top = total === 1 ? '50%' : `${((i + 1) / (total + 1)) * 100}%`;
        return (
          <div key={out.id || i}>
            <Handle
              type="source"
              position={Position.Right}
              id={out.id || 'main'}
              className="node-handle"
              style={{ top }}
            />
            {(isCondition || isLoop) && (
              <span className="handle-label" style={{ top, right: 10 }}>
                {out.label || out.id}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

FlowNode.displayName = 'FlowNode';
export default FlowNode;
