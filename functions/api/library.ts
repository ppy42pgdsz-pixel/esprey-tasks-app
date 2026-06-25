/**
 * GET  /api/library — my library files (newest first).
 * POST /api/library — upload a file to my library (multipart "file").
 */
import { meFromCtx, json } from './_lib';
import { nanoid, summarizeFile, MAX_UPLOAD_BYTES } from './_attachments';

interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  ANTHROPIC_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  const { results } = await ctx.env.DB.prepare(
    'SELECT id, filename, mime_type, size, summary, created_at FROM library_files WHERE user_email = ? ORDER BY created_at DESC',
  ).bind(me).all();
  return json(results);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  const form = await ctx.request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file provided' }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: 'File too large (max 10 MB)' }, 413);

  const buf = await file.arrayBuffer();
  const id = nanoid();
  const r2Key = `library/${me}/${id}`;
  await ctx.env.ATTACHMENTS.put(r2Key, buf, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  const summary = await summarizeFile(ctx.env.ANTHROPIC_API_KEY, file.type, file.name, buf);

  const now = Date.now();
  // New file is unattached → starts the 30-day orphan clock from now.
  await ctx.env.DB.prepare(
    'INSERT INTO library_files (id, user_email, r2_key, filename, mime_type, size, summary, created_at, orphaned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, me, r2Key, file.name, file.type || null, file.size, summary, now, now).run();

  const row = await ctx.env.DB.prepare('SELECT id, filename, mime_type, size, summary, created_at FROM library_files WHERE id = ?').bind(id).first();
  return json(row, 201);
};
