/**
 * Download a file without navigating the page or opening a window — important
 * for the docked/standalone web app, where opening a download URL normally
 * spawns a blank Safari window or blanks the app.
 *
 * The URL must respond with `Content-Disposition: attachment`. A hidden iframe
 * loads it; the browser recognises the attachment and downloads it straight to
 * the Downloads folder, leaving the app untouched.
 */
export function downloadFile(url: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = url;
  document.body.appendChild(iframe);
  window.setTimeout(() => { try { iframe.remove(); } catch { /* noop */ } }, 60000);
}
