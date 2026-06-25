import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Msg { role: 'user' | 'ai'; text: string }

interface Props {
  onApplied: () => void; // refresh the task list after changes are made
}

export default function Assistant({ onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<unknown[] | null>(null);
  const [applying, setApplying] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [msgs, busy, pending]);

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    setPending(null);
    setMsgs((m) => [...m, { role: 'user', text: message }]);
    setBusy(true);
    try {
      const { reply, actions } = await api.assistantPlan(message);
      setMsgs((m) => [...m, { role: 'ai', text: reply }]);
      setPending(actions.length > 0 ? actions : null);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'ai', text: e instanceof Error ? e.message : 'Something went wrong.' }]);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!pending) return;
    setApplying(true);
    try {
      const { results } = await api.assistantExecute(pending);
      setMsgs((m) => [...m, { role: 'ai', text: results.length ? `Done:\n• ${results.join('\n• ')}` : 'Done.' }]);
      setPending(null);
      onApplied();
    } catch (e) {
      setMsgs((m) => [...m, { role: 'ai', text: e instanceof Error ? e.message : 'Could not apply changes.' }]);
    } finally {
      setApplying(false);
    }
  };

  const cancel = () => {
    setPending(null);
    setMsgs((m) => [...m, { role: 'ai', text: 'Okay, cancelled — nothing changed.' }]);
  };

  if (!open) {
    return (
      <button className="ai-fab" onClick={() => setOpen(true)} title="Ask Claude to help with your tasks">
        ✨ Smart AI
      </button>
    );
  }

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <span className="ai-title">✨ Smart AI</span>
        <button className="close-btn" onClick={() => setOpen(false)}>×</button>
      </div>

      <div className="ai-body" ref={bodyRef}>
        {msgs.length === 0 && (
          <div className="ai-hint">
            Ask me to reorganise your tasks — e.g. “merge ‘Waraba Legal’ and ‘Outstanding Legal’ into one called Legal”, “move the contract task into the JV project”, or “add ‘call the lawyer’ to the Ratel project”. I’ll show you what I’ll do before changing anything.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>{m.text}</div>
        ))}
        {busy && <div className="ai-msg ai thinking">Thinking…</div>}
        {pending && pending.length > 0 && !busy && (
          <div className="ai-confirm">
            <button className="btn-primary sm" onClick={apply} disabled={applying}>{applying ? 'Applying…' : 'Apply'}</button>
            <button className="btn-secondary sm" onClick={cancel} disabled={applying}>Cancel</button>
          </div>
        )}
      </div>

      <div className="ai-input">
        <textarea
          rows={2}
          placeholder="Ask Claude…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="btn-primary sm" onClick={send} disabled={busy || !input.trim()}>Send</button>
      </div>
    </div>
  );
}
