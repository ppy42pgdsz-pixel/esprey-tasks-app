/**
 * GET  /api/tasks/:id/attachments — list TASK-LEVEL attachments (shared across subtasks)
 * POST /api/tasks/:id/attachments — upload a task-level file (anyone with access), multipart "file"
 */

import { meFromCtx, canAccessTask } from '../../_lib';
import { nanoid, summarizeFile, MAX_UPLOAD_BYTES } from '../../_attachments';

interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  ANTHROPIC_API_KEY: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await canAccessTask(ctx.env.DB, id, me))) return json({ error: 'Forbidden' }, 403);
  // Task-level files only — subtask uploads (subtask_id set) are listed per subtask.
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, task_id, subtask_id, filename, mime_type, size, summary, created_at
     FROM task_attachments WHERE task_id = ? AND subtask_id IS NULL ORDER BY created_at ASC`,
  ).bind(id).all();
  return json(results);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await canAccessTask(ctx.env.DB, id, me))) return json({ error: 'Forbidden' }, 403);

  const form = await ctx.request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file provided' }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: 'File too large (max 10 MB)' }, 413);

  const buf = await file.arrayBuffer();
  const aid = nanoid();
  const r2Key = `task/${id}/${aid}`;
  await ctx.env.ATTACHMENTS.put(r2Key, buf, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });

  const summary = await summarizeFile(ctx.env.ANTHROPIC_API_KEY, file.type, file.name, buf);

  await ctx.env.DB.prepare(
    'INSERT INTO task_attachments (id, task_id, subtask_id, r2_key, filename, mime_type, size, summary, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)',
  ).bind(aid, id, r2Key, file.name, file.type || null, file.size, summary, Date.now()).run();

  const row = await ctx.env.DB.prepare(
    'SELECT id, task_id, subtask_id, filename, mime_type, size, summary, created_at FROM task_attachments WHERE id = ?',
  ).bind(aid).first();
  return json(row, 201);
};
