import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { LibraryFile } from '../types';

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
  const [doc, setDoc] = useState<{ id: string; name: string } | null>(null);
  const [attachMenu, setAttachMenu] = useState(false);
  const [libFiles, setLibFiles] = useState<LibraryFile[]>([]);
  const [libLoaded, setLibLoaded] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [msgs, busy, pending]);

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    const attached = doc;
    setInput('');
    setPending(null);
    setDoc(null);
    setMsgs((m) => [...m, { role: 'user', text: attached ? `📎 ${attached.name}\n${message}` : message }]);
    setBusy(true);
    try {
      const { reply, actions } = await api.assistantPlan(message, attached?.id);
      setMsgs((m) => [...m, { role: 'ai', text: reply }]);
      setPending(actions.length > 0 ? actions : null);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'ai', text: e instanceof Error ? e.message : 'Something went wrong.' }]);
    } finally {
      setBusy(false);
    }
  };

  const openAttachMenu = async () => {
    const next = !attachMenu;
    setAttachMenu(next);
    if (next && !libLoaded) {
      try { setLibFiles(await api.listLibrary()); } catch { setLibFiles([]); } finally { setLibLoaded(true); }
    }
  };
  const uploadDoc = async (file: File) => {
    setUploadingDoc(true);
    try {
      const lf = await api.uploadToLibrary(file);
      setLibFiles((p) => [lf, ...p]);
      setDoc({ id: lf.id, name: lf.filename || 'file' });
      setAttachMenu(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingDoc(false);
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

      <div className="ai-input-wrap">
        {doc && (
          <div className="ai-doc-chip">📎 {doc.name}<button onClick={() => setDoc(null)} aria-label="Remove document">×</button></div>
        )}
        {attachMenu && (
          <>
          <div className="picker-backdrop" onClick={() => setAttachMenu(false)} />
          <div className="ai-attach-menu">
            <div className="ai-attach-menu-head">
              <span>Attach a document</span>
              <button type="button" className="picker-close" onClick={() => setAttachMenu(false)} aria-label="Close">×</button>
            </div>
            <label className="ai-attach-opt">
              {uploadingDoc ? 'Uploading…' : '⬆ Upload a file'}
              <input type="file" hidden disabled={uploadingDoc} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f); e.target.value = ''; }} />
            </label>
            <div className="ai-attach-lib-head">From library</div>
            {!libLoaded ? (
              <div className="lib-empty">Loading…</div>
            ) : libFiles.length === 0 ? (
              <div className="lib-empty">No files in your library yet.</div>
            ) : (
              libFiles.map((f) => (
                <button key={f.id} type="button" className="ai-lib-item" onClick={() => { setDoc({ id: f.id, name: f.filename || 'file' }); setAttachMenu(false); }}>📎 {f.filename}</button>
              ))
            )}
          </div>
          </>
        )}
        <div className="ai-input">
          <button className="ai-attach-btn" title="Attach a document" onClick={openAttachMenu}>📎</button>
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
    </div>
  );
}
