/** Shared helpers for file uploads + AI summaries (task-level and subtask-level). */

export function nanoid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 21);
}

/**
 * Call AFTER removing a task attachment that referenced a library file. If no
 * task still references that library file, start its 30-day orphan clock.
 */
export async function releaseLibraryRef(db: D1Database, libraryFileId: string): Promise<void> {
  const stillUsed = await db.prepare('SELECT 1 FROM task_attachments WHERE library_file_id = ? LIMIT 1').bind(libraryFileId).first();
  if (!stillUsed) {
    await db.prepare('UPDATE library_files SET orphaned_at = ? WHERE id = ? AND orphaned_at IS NULL').bind(Date.now(), libraryFileId).run();
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;     // 10 MB upload cap
const SUMMARY_MAX_BYTES = 5 * 1024 * 1024;            // only auto-summarize up to 5 MB

/** 1–2 sentence Claude description. Returns null for unsupported types or any error. */
export async function summarizeFile(apiKey: string, mime: string, filename: string, buf: ArrayBuffer): Promise<string | null> {
  if (buf.byteLength > SUMMARY_MAX_BYTES) return null;
  const lower = (mime || '').toLowerCase();
  let media: unknown;
  if (lower.startsWith('image/')) {
    media = { type: 'image', source: { type: 'base64', media_type: lower, data: toBase64(buf) } };
  } else if (lower === 'application/pdf') {
    media = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(buf) } };
  } else if (lower.startsWith('text/') || lower === 'application/json') {
    const text = new TextDecoder().decode(buf).slice(0, 8000);
    media = { type: 'text', text: `File "${filename}" contents:\n\n${text}` };
  } else {
    return null;
  }
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: [media, { type: 'text', text: 'In 1-2 sentences, summarize what this file is and its key contents. Be concise and factual. Output only the summary.' }] }],
      }),
    });
    if (!resp.ok) return null;
    const r = await resp.json<{ content: Array<{ type: string; text: string }> }>();
    return r.content.find((c) => c.type === 'text')?.text?.trim() || null;
  } catch {
    return null;
  }
}
