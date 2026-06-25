import { useEffect, useMemo, useState } from 'react';
import type { LibraryFile } from '../types';
import { api } from '../api';
import { downloadFile } from '../download';
import PdfPreview from './PdfPreview';

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtSize = (n?: number | null) => (n ? `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB` : '');
// Relative "added X ago" so you can spot something you just emailed in.
function addedAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return fmtDate(ms);
}
const isPdf = (f: LibraryFile) =>
  (f.mime_type ?? '').toLowerCase() === 'application/pdf' ||
  (f.filename ?? '').toLowerCase().endsWith('.pdf');

interface Props { onClose: () => void }

export default function LibraryPanel({ onClose }: Props) {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => { setLoading(true); api.listLibrary().then(setFiles).catch(() => setFiles([])).finally(() => setLoading(false)); };
  useEffect(load, []);

  const previewFile = useMemo(() => files.find((f) => f.id === previewId) ?? null, [files, previewId]);

  const upload = async (file: File) => {
    setUploading(true);
    try { const lf = await api.uploadToLibrary(file); setFiles((p) => [lf, ...p]); }
    catch (e) { alert(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setUploading(false); }
  };

  const toggle = (id: string) => setSelected((p) => {
    const n = new Set(p);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const allSelected = files.length > 0 && selected.size === files.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(files.map((f) => f.id)));

  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const names = ids.length === 1 ? `"${files.find((f) => f.id === ids[0])?.filename}"` : `${ids.length} files`;
    if (!confirm(`Remove ${names} from your library? They will also be detached from any tasks.`)) return;
    setDeleting(true);
    try {
      await Promise.all(ids.map((id) => api.deleteLibraryFile(id)));
      setFiles((p) => p.filter((x) => !selected.has(x.id)));
      if (previewId && selected.has(previewId)) setPreviewId(null);
      setSelected(new Set());
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
      load();
    } finally { setDeleting(false); }
  };

  return (
    <div className="settings-page-overlay" onClick={onClose}>
      <div className="library-page" onClick={(e) => e.stopPropagation()}>
        <div className="settings-page-header">
          <button className="back-btn" onClick={onClose}>← Back</button>
          <h2 className="settings-page-title">Library</h2>
          <label className="btn-primary" style={{ cursor: 'pointer' }}>
            {uploading ? 'Uploading…' : '+ Upload'}
            <input type="file" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          </label>
        </div>

        <div className="library-body">
          {/* Left: file list */}
          <section className="library-list-col">
            <div className="library-list-bar">
              {selected.size > 0 ? (
                <>
                  <label className="lib-select-all">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} /> {selected.size} selected
                  </label>
                  <button className="btn-danger-sm" disabled={deleting} onClick={deleteSelected}>
                    {deleting ? 'Deleting…' : `Delete (${selected.size})`}
                  </button>
                </>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>
                  {files.length} file{files.length === 1 ? '' : 's'} · click a PDF to preview · unattached files are removed after 30 days
                </span>
              )}
            </div>

            {loading ? (
              <p className="muted" style={{ padding: '8px 4px' }}>Loading…</p>
            ) : files.length === 0 ? (
              <p className="muted" style={{ padding: '8px 4px' }}>No files yet. Upload one above, or forward an email to add it to your library.</p>
            ) : (
              <ul className="library-list">
                {files.map((f) => (
                  <li key={f.id} className={`lib-row${previewId === f.id ? ' active' : ''}`}>
                    <input type="checkbox" className="lib-check" checked={selected.has(f.id)} onChange={() => toggle(f.id)} onClick={(e) => e.stopPropagation()} />
                    <div className="lib-row-main" onClick={() => isPdf(f) ? setPreviewId(f.id) : downloadFile(`/api/library/${f.id}?download=1`)}>
                      <div className="file-name">{isPdf(f) ? '📄' : '📎'} {f.filename}</div>
                      <div className="lib-row-meta">added {addedAgo(f.created_at)}{f.size ? ` · ${fmtSize(f.size)}` : ''}</div>
                      {f.summary
                        ? <div className="lib-summary-strong">{f.summary}</div>
                        : <div className="lib-row-meta">No summary yet.</div>}
                    </div>
                    <button className="link-btn" onClick={(e) => { e.stopPropagation(); downloadFile(`/api/library/${f.id}?download=1`); }}>Download</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Right: preview pane */}
          <section className="library-preview-col">
            {!previewFile ? (
              <div className="lib-preview-empty">Select a PDF to preview it here.</div>
            ) : isPdf(previewFile) ? (
              <>
                <div className="lib-preview-head">
                  <span className="lib-preview-name" title={previewFile.filename ?? ''}>{previewFile.filename}</span>
                  <button className="link-btn" onClick={() => downloadFile(`/api/library/${previewFile.id}?download=1`)}>Download</button>
                </div>
                <PdfPreview key={previewFile.id} url={`/api/library/${previewFile.id}`} />
              </>
            ) : (
              <div className="lib-preview-empty">
                Preview isn’t available for this file type.
                <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => downloadFile(`/api/library/${previewFile.id}?download=1`)}>Download</button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
