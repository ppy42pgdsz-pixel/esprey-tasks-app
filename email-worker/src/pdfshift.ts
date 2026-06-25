/** PDFShift HTML-to-PDF (https://pdfshift.io). Returns the PDF bytes. */
export async function htmlToPdf(opts: {
  apiKey: string;
  html: string;
  format?: 'A4' | 'Letter';
  margin?: string;       // e.g. "20mm"
  landscape?: boolean;
}): Promise<Uint8Array> {
  const res = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // PDFShift uses HTTP Basic auth: username "api", password = your API key.
      Authorization: 'Basic ' + btoa('api:' + opts.apiKey),
    },
    body: JSON.stringify({
      source: opts.html,
      format: opts.format ?? 'A4',
      margin: opts.margin ?? '20mm',
      landscape: !!opts.landscape,
      sandbox: false,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PDFShift ${res.status}: ${errText.slice(0, 400)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
