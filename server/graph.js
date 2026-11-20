import crypto from 'node:crypto';
import { NODE_MAP, NODE_TYPES } from './engine/catalog.js';

/** Validate and normalise a workflow graph coming from the client. */
export function normalizeGraph(graph) {
  if (!graph || typeof graph !== 'object') throw new Error('Graph must be an object with nodes and edges.');
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];

  const seen = new Set();
  const normalizedNodes = nodes.map((node, index) => {
    if (!node || typeof node !== 'object') throw new Error(`Node #${index + 1} is not an object.`);
    const type = String(node.type || '');
    if (!NODE_MAP.has(type)) throw new Error(`Unknown node type "${type}".`);
    let id = String(node.id || crypto.randomUUID());
    while (seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    return {
      id,
      type,
      position: {
        x: Number(node.position?.x) || 0,
        y: Number(node.position?.y) || 0,
      },
      data: node.data && typeof node.data === 'object' ? node.data : {},
    };
  });

  const ids = new Set(normalizedNodes.map((n) => n.id));
  const normalizedEdges = [];
  for (const edge of edges) {
    if (!edge || typeof edge !== 'object') continue;
    if (!ids.has(String(edge.source)) || !ids.has(String(edge.target))) continue;
    normalizedEdges.push({
      id: String(edge.id || crypto.randomUUID()),
      source: String(edge.source),
      target: String(edge.target),
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    });
  }

  return { nodes: normalizedNodes, edges: normalizedEdges };
}

export function validateGraph(graph) {
  const warnings = [];
  const errors = [];
  const loops = graph.nodes.filter((n) => n.type === 'core.loop');
  for (const loop of loops) {
    const bodyEdges = graph.edges.filter((e) => e.source === loop.id && (e.sourceHandle || 'main') === 'each');
    if (!bodyEdges.length) warnings.push(`"${loop.data?.label || 'For each'}" has no body connected to its "each" output.`);
  }
  const triggers = graph.nodes.filter((n) => NODE_MAP.get(n.type)?.category === 'trigger');
  if (!triggers.length) warnings.push('No trigger node: this workflow can only be run manually.');
  if (triggers.length > 1) warnings.push('More than one trigger node: pick one flow per workflow for predictable schedules.');

  // Cycle detection across explicit flow edges (loops are explicit, so plain cycles are almost always a mistake).
  const adj = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const edge of graph.edges) adj.get(edge.source)?.push(edge.target);
  const color = new Map();
  const visit = (id, stack) => {
    color.set(id, 1);
    for (const next of adj.get(id) || []) {
      if (color.get(next) === 1) errors.push(`Cycle detected: ${[...stack, id, next].join(' → ')}. Use a For each node instead of wiring a loop back.`);
      else if (!color.get(next)) visit(next, [...stack, id]);
    }
    color.set(id, 2);
  };
  for (const node of graph.nodes) if (!color.get(node.id)) visit(node.id, []);
  return { errors, warnings };
}

export function nodeDefaults(type) {
  const def = NODE_MAP.get(type);
  if (!def) return {};
  const data = {};
  for (const field of def.fields || []) if (field.default !== undefined) data[field.key] = field.default;
  return data;
}

export function catalogPayload() {
  return NODE_TYPES.map((n) => ({
    type: n.type, label: n.label, category: n.category, icon: n.icon,
    description: n.description, inputs: n.inputs || [], outputs: n.outputs || [],
    fields: n.fields || [],
  }));
}
