import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

const PDFJS_VERSION = "3.11.174";
const PDFJS_SRC = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}
interface PdfPage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: { canvasContext: CanvasRenderingContext2D; viewport: any }): { promise: Promise<void> };
}

declare global {
  interface Window { pdfjsLib?: any; }
}

async function ensurePdfJsLoaded(): Promise<any> {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PDFJS_SRC;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load pdf.js"));
    document.head.appendChild(s);
  });
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("pdf.js global not found after load");
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return lib;
}

export default function PdfView() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const file = params.get("file") ?? "";

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PdfDocument | null>(null);
  const blobRef = useRef<Blob | null>(null);

  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  // CHANGE THESE TWO LINES to match your app's endpoints.
  const company = params.get("company") ?? "";
  const companyQs = company ? `&company=${encodeURIComponent(company)}` : "";
  const downloadUrl = `/api/reports/download?file=${encodeURIComponent(file)}${companyQs}`;
  const viewUrl     = `/api/reports/view?file=${encodeURIComponent(file)}${companyQs}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr(null); setBusy(true);
      try {
        const lib = await ensurePdfJsLoaded();
        const loadingTask = lib.getDocument({ url: viewUrl, withCredentials: true });
        const doc: PdfDocument = await loadingTask.promise;
        if (cancelled) return;
        docRef.current = doc;
        setTotalPages(doc.numPages);
        setPageNum(1);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const canvas = canvasRef.current!;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const containerWidth = Math.min(window.innerWidth - 16, 1200);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = (containerWidth / baseViewport.width) * dpr;
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [pageNum, totalPages]);

  function prev() { setPageNum((n) => Math.max(1, n - 1)); }
  function next() { setPageNum((n) => Math.min(totalPages || 1, n + 1)); }

  // Pre-fetch the file bytes so Save can hand them off within the click gesture
  // (Safari needs the share call to happen during the user gesture).
  useEffect(() => {
    blobRef.current = null;
    let cancelled = false;
    fetch(downloadUrl, { credentials: "include" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (!cancelled && b) blobRef.current = b; })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [file]);

  // Save the PDF WITHOUT navigating the window (which blanks a standalone/docked
  // web app that has no browser chrome to go back from). Prefer the OS share
  // sheet ("Save to Files"); fall back to a normal download link in browsers.
  async function save() {
    try {
      let blob = blobRef.current;
      if (!blob) {
        const res = await fetch(downloadUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        blob = await res.blob();
        blobRef.current = blob;
      }

      // iPhone/iPad ignore the download attribute, so use the OS share sheet there.
      const touchApple = /iP(ad|hone|od)/.test(navigator.userAgent)
        || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
      const nav = navigator as any;
      if (touchApple && nav.canShare) {
        const pdfFile = new File([blob], file || "report.pdf", { type: "application/pdf" });
        if (nav.canShare({ files: [pdfFile] })) {
          try { await nav.share({ files: [pdfFile], title: file }); }
          catch (e) { if ((e as Error).name !== "AbortError") setErr((e as Error).message); }
          return;
        }
      }

      // Desktop (incl. a docked Mac web app): a plain download — straight to the
      // Downloads folder, or a "where to save?" dialog if Safari is set to ask.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file || "report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="pdf-view">
      <header className="pdf-view-bar">
        <button
          type="button"
          className="back-btn"
          onClick={() => (history.length > 1 ? navigate(-1) : navigate("/"))}
        >← Back</button>
        <span className="pdf-view-title">{file}</span>
        <button type="button" onClick={save} className="download-link">Save</button>
      </header>

      {err && <div className="err" style={{ margin: 12 }}>{err}</div>}

      <div className="pdf-canvas-wrap">
        {busy && <div className="pdf-loading">Loading PDF…</div>}
        <canvas ref={canvasRef} className="pdf-canvas" />
      </div>

      {totalPages > 0 && (
        <footer className="pdf-view-pager">
          <button type="button" className="pager-btn" onClick={prev} disabled={pageNum <= 1}>‹ Prev</button>
          <span className="pager-info">Page {pageNum} of {totalPages}</span>
          <button type="button" className="pager-btn" onClick={next} disabled={pageNum >= totalPages}>Next ›</button>
        </footer>
      )}
    </div>
  );
}
