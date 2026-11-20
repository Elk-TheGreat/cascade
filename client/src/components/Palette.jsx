import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { NodeIcon } from '../icons.jsx';

const ORDER = ['trigger', 'code', 'flow', 'browser', 'desktop', 'ai', 'integration'];

export default function Palette({ catalog, categories, onAdd }) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = catalog.filter((n) =>
      !q || n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q) || n.type.includes(q));
    return ORDER.map((id) => {
      const meta = categories.find((c) => c.id === id) || { id, label: id };
      return { ...meta, nodes: filtered.filter((n) => n.category === id) };
    }).filter((g) => g.nodes.length);
  }, [catalog, categories, query]);

  return (
    <aside className="palette">
      <div className="palette-head">
        <div className="palette-search">
          <Search size={13} />
          <input
            className="input"
            placeholder="Search steps…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="palette-body">
        {groups.map((group) => (
          <div key={group.id}>
            <div className="cat-label">{group.label}</div>
            {group.nodes.map((node) => (
              <div
                key={node.type}
                className="palette-item"
                draggable
                title={node.description}
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/cascade-node', node.type);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDoubleClick={() => onAdd(node.type)}
              >
                <span className="palette-icon"><NodeIcon name={node.icon} size={13} /></span>
                <span>{node.label}</span>
              </div>
            ))}
          </div>
        ))}
        {!groups.length && <div className="empty" style={{ margin: 8, padding: 24 }}><p>No step matches “{query}”.</p></div>}
      </div>
    </aside>
  );
}
