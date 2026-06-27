import { useState } from 'react';
import type { LibraryFile, TaskAttachment } from '../types';
import { api } from '../api';

interface Props {
  target: { task_id?: string; subtask_id?: string };
  onAttached: (att: TaskAttachment) => void;
}

export default function LibraryPicker({ target, onAttached }: Props) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    try { setFiles(await api.listLibrary()); } catch { setFiles([]); } finally { setLoaded(true); }
  };
  const toggle = () => { const next = !open; setOpen(next); if (next && !loaded) load(); };

  const attach = async (f: LibraryFile) => {
    setBusyId(f.id);
    try {
      const att = await api.attachLibraryFile(f.id, target);
      onAttached(att);
      setOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not attach');
    } finally {
      setBusyId(null);
    }
  };

  const uploadToLibrary = async (file: File) => {
    setUploading(true);
    try {
      const lf = await api.uploadToLibrary(file);
      setFiles((prev) => [lf, ...prev]);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removeFromLibrary = async (f: LibraryFile) => {
    if (!confirm(`Remove "${f.filename}" from your library? It will also be detached from any tasks.`)) return;
    await api.deleteLibraryFile(f.id);
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
  };

  return (
    <div className="lib-picker">
      <button type="button" className="attach-btn" onClick={toggle}>📁 From library</button>
      {open && (
        <>
        <div className="picker-backdrop" onClick={() => setOpen(false)} />
        <div className="lib-pop">
          <div className="lib-pop-head">
            <span>Your library</span>
            <span className="lib-pop-head-right">
              <label className="lib-upload">
                {uploading ? 'Uploading…' : '+ Add file'}
                <input type="file" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadToLibrary(f); e.target.value = ''; }} />
              </label>
              <button type="button" className="picker-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </span>
          </div>
          {!loaded ? (
            <div className="lib-empty">Loading…</div>
          ) : files.length === 0 ? (
            <div className="lib-empty">No files yet. Add one above, or forward an email to your library.</div>
          ) : (
            <ul className="lib-list">
              {files.map((f) => (
                <li key={f.id} className="lib-item">
                  <div className="lib-item-main">
                    <div className="lib-name">📎 {f.filename}</div>
                    {f.summary && <div className="lib-summary">{f.summary}</div>}
                  </div>
                  <div className="lib-item-actions">
                    <button className="btn-primary sm" disabled={busyId === f.id} onClick={() => attach(f)}>{busyId === f.id ? '…' : 'Attach'}</button>
                    <button className="lib-del" title="Remove from library" onClick={() => removeFromLibrary(f)}>✕</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        </>
      )}
    </div>
  );
}
