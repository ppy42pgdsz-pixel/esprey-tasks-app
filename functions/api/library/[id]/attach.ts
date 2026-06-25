/**
 * POST /api/library/:id/attach  { task_id } or { subtask_id }
 * Attach one of my library files to a task (project-level) or a specific task
 * item. The attachment references the SAME stored object (no copy), and the
 * library file is marked attached (orphaned_at cleared).
 */
import { meFromCtx, canAccessTask, canUpdateSubtask, json } from '../../_lib';
import { nanoid } from '../../_attachments';

interface Env { DB: D1Database }

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);

  const lib = await ctx.env.DB.prepare('SELECT r2_key, filename, mime_type, size, summary FROM library_files WHERE id = ? AND user_email = ?')
    .bind(id, me).first<{ r2_key: string; filename: string | null; mime_type: string | null; size: number | null; summary: string | null }>();
  if (!lib) return json({ error: 'Library file not found' }, 404);

  const body = await ctx.request.json<{ task_id?: string; subtask_id?: string }>().catch(() => ({} as { task_id?: string; subtask_id?: string }));

  let taskId = body.task_id ?? null;
  let subtaskId = body.subtask_id ?? null;

  if (subtaskId) {
    if (!(await canUpdateSubtask(ctx.env.DB, subtaskId, me))) return json({ error: 'Not allowed' }, 403);
    const sub = await ctx.env.DB.prepare('SELECT task_id FROM subtasks WHERE id = ?').bind(subtaskId).first<{ task_id: string }>();
    if (!sub) return json({ error: 'Task not found' }, 404);
    taskId = sub.task_id;
  } else if (taskId) {
    if (!(await canAccessTask(ctx.env.DB, taskId, me))) return json({ error: 'Not allowed' }, 403);
  } else {
    return json({ error: 'task_id or subtask_id required' }, 400);
  }

  const aid = nanoid();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      'INSERT INTO task_attachments (id, task_id, subtask_id, r2_key, filename, mime_type, size, summary, created_at, library_file_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(aid, taskId, subtaskId, lib.r2_key, lib.filename, lib.mime_type, lib.size, lib.summary, Date.now(), id),
    ctx.env.DB.prepare('UPDATE library_files SET orphaned_at = NULL WHERE id = ?').bind(id),
  ]);

  const row = await ctx.env.DB.prepare(
    'SELECT id, task_id, subtask_id, filename, mime_type, size, summary, created_at FROM task_attachments WHERE id = ?',
  ).bind(aid).first();
  return json(row, 201);
};
