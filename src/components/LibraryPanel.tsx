import { useEffect, useState } from 'react';
import type { LibraryFile } from '../types';
import { api } from '../api';
import { downloadFile } from '../download';

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtSize = (n?: number | null) => (n ? `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB` : '');

interface Props { onClose: () => void }

export default function LibraryPanel({ onClose }: Props) {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = () => { setLoading(true); api.listLibrary().then(setFiles).catch(() => setFiles([])).finally(() => setLoading(false)); };
  useEffect(load, []);

  const upload = async (file: File) => {
    setUploading(true);
    try { const lf = await api.uploadToLibrary(file); setFiles((p) => [lf, ...p]); }
    catch (e) { alert(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setUploading(false); }
  };
  const remove = async (f: LibraryFile) => {
    if (!confirm(`Remove "${f.filename}" from your library? It will also be detached from any tasks.`)) return;
    await api.deleteLibraryFile(f.id);
    setFiles((p) => p.filter((x) => x.id !== f.id));
  };

  return (
    <div className="settings-page-overlay" onClick={onClose}>
      <div className="settings-page" onClick={(e) => e.stopPropagation()}>
        <div className="settings-page-header">
          <button className="back-btn" onClick={onClose}>← Back</button>
          <h2 className="settings-page-title">Library</h2>
          <span className="header-spacer" />
        </div>

        <section className="settings-card">
          <div className="settings-card-row">
            <p className="muted" style={{ margin: 0 }}>Your private file library. Attach these to any task from its Files area. Files left unattached for 30 days are removed.</p>
            <label className="btn-primary" style={{ cursor: 'pointer' }}>
              {uploading ? 'Uploading…' : '+ Upload file'}
              <input type="file" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            </label>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-label">Files ({files.length})</div>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : files.length === 0 ? (
            <p className="muted">No files yet. Upload one above, or forward an email to add it to your library.</p>
          ) : (
            <ul className="settings-list">
              {files.map((f) => (
                <li key={f.id} className="lib-row">
                  <div className="lib-row-main">
                    <button type="button" className="file-name file-link" onClick={() => downloadFile(`/api/library/${f.id}?download=1`)}>📎 {f.filename}</button>
                    <div className="lib-row-meta">{[fmtSize(f.size), `added ${fmtDate(f.created_at)}`].filter(Boolean).join(' · ')}</div>
                    {f.summary && <div className="lib-summary">{f.summary}</div>}
                  </div>
                  <button className="link-btn danger" onClick={() => remove(f)}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
