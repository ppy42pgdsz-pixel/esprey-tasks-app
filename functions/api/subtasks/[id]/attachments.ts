/**
 * GET  /api/subtasks/:id/attachments — list a subtask's uploaded files (with AI summary)
 * POST /api/subtasks/:id/attachments — upload a file (owner or assignee), multipart "file"
 */
import { meFromCtx, canAccessTask, canUpdateSubtask } from '../../_lib';

interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  ANTHROPIC_API_KEY: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function nanoid() { return crypto.randomUUID().replace(/-/g, '').slice(0, 21); }

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

const MAX_BYTES = 10 * 1024 * 1024;        // 10 MB upload cap
const SUMMARY_MAX_BYTES = 5 * 1024 * 1024; // only auto-summarize files up to 5 MB

/** Ask Claude for a 1–2 sentence description. Returns null on unsupported types or any error. */
async function summarize(env: Env, mime: string, filename: string, buf: ArrayBuffer): Promise<string | null> {
  const lower = (mime || '').toLowerCase();
  let media: unknown;
  if (lower.startsWith('image/')) {
    media = { type: 'image', source: { type: 'base64', media_type: lower, data: toBase64(buf) } };
  } else if (lower === 'application/pdf') {
    media = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(buf) } };
  } else if (lower.startsWith('text/') || lower === 'application/json' || lower === 'text/csv') {
    const text = new TextDecoder().decode(buf).slice(0, 8000);
    media = { type: 'text', text: `File "${filename}" contents:\n\n${text}` };
  } else {
    return null;
  }
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
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

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  const sub = await ctx.env.DB.prepare('SELECT task_id FROM subtasks WHERE id = ?').bind(id).first<{ task_id: string }>();
  if (!sub) return json({ error: 'Not found' }, 404);
  if (!(await canAccessTask(ctx.env.DB, sub.task_id, me))) return json({ error: 'Forbidden' }, 403);
  const { results } = await ctx.env.DB.prepare(
    'SELECT id, task_id, subtask_id, filename, mime_type, size, summary, created_at FROM task_attachments WHERE subtask_id = ? ORDER BY created_at ASC',
  ).bind(id).all();
  return json(results);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  const sub = await ctx.env.DB.prepare('SELECT task_id FROM subtasks WHERE id = ?').bind(id).first<{ task_id: string }>();
  if (!sub) return json({ error: 'Not found' }, 404);
  if (!(await canUpdateSubtask(ctx.env.DB, id, me))) return json({ error: 'Only the owner or an assignee can attach files' }, 403);

  const form = await ctx.request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file provided' }, 400);
  if (file.size > MAX_BYTES) return json({ error: 'File too large (max 10 MB)' }, 413);

  const buf = await file.arrayBuffer();
  const aid = nanoid();
  const r2Key = `subtask/${id}/${aid}`;
  await ctx.env.ATTACHMENTS.put(r2Key, buf, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });

  const summary = file.size <= SUMMARY_MAX_BYTES ? await summarize(ctx.env, file.type, file.name, buf) : null;

  await ctx.env.DB.prepare(
    'INSERT INTO task_attachments (id, task_id, subtask_id, r2_key, filename, mime_type, size, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(aid, sub.task_id, id, r2Key, file.name, file.type || null, file.size, summary, Date.now()).run();

  const row = await ctx.env.DB.prepare(
    'SELECT id, task_id, subtask_id, filename, mime_type, size, summary, created_at FROM task_attachments WHERE id = ?',
  ).bind(aid).first();
  return json(row, 201);
};
