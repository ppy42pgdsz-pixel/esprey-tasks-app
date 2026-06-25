import { useEffect, useRef, useState } from "react";

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

/** Lightweight inline PDF renderer for a preview pane. Pass the inline (not
 * download) URL of the PDF. Renders one page at a time with prev/next paging. */
export default function PdfPreview({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<PdfDocument | null>(null);

  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr(null); setBusy(true); setTotalPages(0); docRef.current = null;
      try {
        const lib = await ensurePdfJsLoaded();
        const doc: PdfDocument = await lib.getDocument({ url, withCredentials: true }).promise;
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
  }, [url]);

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
        const containerWidth = Math.max(280, (wrapRef.current?.clientWidth ?? 600) - 24);
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

  return (
    <div className="pdf-preview">
      {err && <div className="err" style={{ margin: 12 }}>{err}</div>}
      <div className="pdf-preview-wrap" ref={wrapRef}>
        {busy && <div className="pdf-loading">Loading PDF…</div>}
        <canvas ref={canvasRef} className="pdf-canvas" />
      </div>
      {totalPages > 1 && (
        <div className="pdf-preview-pager">
          <button type="button" className="pager-btn" onClick={() => setPageNum((n) => Math.max(1, n - 1))} disabled={pageNum <= 1}>‹ Prev</button>
          <span className="pager-info">Page {pageNum} of {totalPages}</span>
          <button type="button" className="pager-btn" onClick={() => setPageNum((n) => Math.min(totalPages, n + 1))} disabled={pageNum >= totalPages}>Next ›</button>
        </div>
      )}
    </div>
  );
}
