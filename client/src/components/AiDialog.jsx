import { useState } from 'react';
import { Sparkles, X, ArrowRight, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import { NodeIcon } from '../icons.jsx';

const EXAMPLES = [
  'Every morning at 8 scrape Hacker News and summarise the headlines',
  'When a webhook arrives, clean the payload in Python and post it to Slack',
  'Open example.com, screenshot it, and email me the file every Friday',
  'Take a desktop screenshot every hour and save it',
  'Post a Discord message when a GitHub repo passes 100k stars',
];

export default function AiDialog({ open, onClose, onApply, catalog, aiStatus }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  if (!open) return null;

  const typeMap = new Map(catalog.map((c) => [c.type, c]));

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const data = await api.generate(prompt.trim());
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setResult(null);
    setError('');
    onClose();
  };

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal">
        <div className="modal-head">
          <div className="ai-sparkle"><Sparkles size={17} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 620 }}>Generate a workflow</div>
            <div className="tiny muted" style={{ marginTop: 3 }}>
              Describe the outcome. Cascade drafts the steps and wiring for you.
            </div>
          </div>
          <button className="btn icon ghost" onClick={close}><X size={14} /></button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label className="field-label" htmlFor="ai-prompt">What should happen?</label>
            <textarea
              id="ai-prompt"
              className="textarea"
              style={{ minHeight: 96, fontFamily: 'inherit', fontSize: 13 }}
              placeholder="Every weekday at 9, fetch my Stripe balance, and if it drops below $1000, email me…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
            />
          </div>

          <div className="ai-examples">
            {EXAMPLES.map((example) => (
              <button key={example} className="ai-chip" onClick={() => setPrompt(example)}>{example}</button>
            ))}
          </div>

          <div className="row tiny faint">
            <span className={`status-dot ${aiStatus?.available ? 'on' : 'warn'}`} />
            {aiStatus?.available
              ? `Using ${aiStatus.provider}${aiStatus.model ? ` · ${aiStatus.model}` : ''}${
                aiStatus.source === 'local' ? ' (local Ollama)'
                  : aiStatus.source?.startsWith('connection:') ? ` (${aiStatus.source.slice(11)})` : ''
              }.`
              : 'No model connected — run Ollama locally or add an OLLAMA_BASE_URL. Cascade will use its built-in planner meanwhile.'}
          </div>

          {error && <div className="badge red" style={{ alignSelf: 'flex-start' }}>{error}</div>}

          {busy && (
            <div className="row muted tiny" style={{ padding: 18, justifyContent: 'center' }}>
              <Loader2 size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }} /> Drafting the plan…
            </div>
          )}

          {result && (
            <>
              <div className="divider" />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{result.name}</div>
                <p className="tiny muted" style={{ lineHeight: 1.6, marginTop: 4 }}>{result.reply}</p>
              </div>
              <div className="plan-list">
                {result.graph.nodes.map((node, index) => {
                  const def = typeMap.get(node.type);
                  return (
                    <div key={node.id} className="plan-item">
                      <span className="idx">{String(index + 1).padStart(2, '0')}</span>
                      <span className="palette-icon"><NodeIcon name={def?.icon} size={12} /></span>
                      <span style={{ flex: 1 }}>{node.data?.label || def?.label || node.type}</span>
                      <span className="tiny faint mono">{node.type}</span>
                    </div>
                  );
                })}
              </div>
              <div className="tiny faint">
                {result.graph.edges.length} connections · {result.source === 'ai' ? 'model draft' : 'built-in planner'}
                {result.warnings?.length ? ` · ${result.warnings.join(' ')}` : ''}
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={close}>Cancel</button>
          {!result ? (
            <button className="btn primary" onClick={generate} disabled={!prompt.trim() || busy}>
              <Sparkles size={13} /> {busy ? 'Generating…' : 'Generate draft'}
            </button>
          ) : (
            <>
              <button className="btn" onClick={() => { setResult(null); generate(); }}>Regenerate</button>
              <button className="btn primary" onClick={() => { onApply(result); close(); }}>
                Use this workflow <ArrowRight size={13} />
              </button>
            </>
          )}
        </div>
      </div>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}
