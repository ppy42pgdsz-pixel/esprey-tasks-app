/**
 * PATCH  /api/subtasks/:id — update a subtask { text?, done? }
 * DELETE /api/subtasks/:id — delete a subtask
 */

import { meFromCtx, isTaskOwner, isSubtaskAssignee } from '../_lib';

interface Env { DB: D1Database }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

type SubStatus = 'todo' | 'in_progress' | 'done';

// Only the owner of the subtask's parent task may change/delete it.
async function ownsSubtask(ctx: { env: Env; data: Record<string, unknown> }, subtaskId: string): Promise<boolean> {
  const me = await meFromCtx(ctx.env.DB, ctx);
  const sub = await ctx.env.DB.prepare('SELECT task_id FROM subtasks WHERE id = ?').bind(subtaskId).first<{ task_id: string }>();
  if (!sub) return false;
  return isTaskOwner(ctx.env.DB, sub.task_id, me);
}

export const onRequestPatch: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  const sub = await ctx.env.DB.prepare('SELECT task_id, accepted_at FROM subtasks WHERE id = ?').bind(id).first<{ task_id: string; accepted_at: number | null }>();
  if (!sub) return json({ error: 'Not found' }, 404);
  const owner = await isTaskOwner(ctx.env.DB, sub.task_id, me);
  // Owner can edit anything; an assignee may update status + shared notes only.
  const canUpdate = owner || (await isSubtaskAssignee(ctx.env.DB, id, me));
  if (!canUpdate) return json({ error: 'Not allowed to edit this subtask' }, 403);

  const body = await ctx.request.json<{ text?: string; done?: boolean; status?: SubStatus; notes?: string; accepted?: boolean; due_date?: number | null; instructions?: string; completion_note?: string }>();

  const updates: string[] = [];
  const values: unknown[] = [];

  if ('text' in body) {
    if (!owner) return json({ error: 'Only the owner can rename a subtask' }, 403);
    const text = body.text?.trim();
    if (!text) return json({ error: 'text cannot be empty' }, 400);
    updates.push('text = ?');
    values.push(text.slice(0, 300));
  }
  if ('due_date' in body) {
    if (!owner) return json({ error: 'Only the owner can set a due date' }, 403);
    updates.push('due_date = ?');
    values.push(typeof body.due_date === 'number' ? body.due_date : null);
  }
  if ('notes' in body) {
    updates.push('notes = ?');
    values.push((body.notes ?? '').slice(0, 5000));
  }
  if ('instructions' in body) {
    if (!owner) return json({ error: 'Only the owner can write instructions' }, 403);
    updates.push('instructions = ?');
    values.push((body.instructions ?? '').slice(0, 5000));
  }
  if ('completion_note' in body) {
    updates.push('completion_note = ?');
    values.push((body.completion_note ?? '').slice(0, 5000));
  }

  // Owner sign-off: accept (lock as done + stamp) or reinstate (back to in progress).
  if ('accepted' in body) {
    if (!owner) return json({ error: 'Only the owner can sign off a subtask' }, 403);
    if (body.accepted) {
      updates.push('status = ?'); values.push('done');
      updates.push('done = ?'); values.push(1);
      updates.push('accepted_at = ?'); values.push(Date.now());
    } else {
      updates.push('status = ?'); values.push('in_progress');
      updates.push('done = ?'); values.push(0);
      updates.push('accepted_at = ?'); values.push(null);
    }
  } else if ('status' in body || 'done' in body) {
    // A member can't change a subtask the owner has already signed off.
    if (!owner && sub.accepted_at) return json({ error: 'This subtask has been signed off by the owner' }, 403);
    const status: SubStatus = 'status' in body
      ? (body.status === 'in_progress' || body.status === 'done' ? body.status : 'todo')
      : (body.done ? 'done' : 'todo');
    updates.push('status = ?');
    values.push(status);
    updates.push('done = ?'); // keep the legacy flag in sync
    values.push(status === 'done' ? 1 : 0);
    // Sign-off coupling: the owner's own "done" auto-accepts; a member's "done"
    // is pending sign-off (accepted_at stays null); leaving "done" clears it.
    updates.push('accepted_at = ?');
    values.push(status === 'done' && owner ? Date.now() : null);
  }
  if (updates.length === 0) return json({ error: 'No valid fields to update' }, 400);

  values.push(id);
  await ctx.env.DB.prepare(`UPDATE subtasks SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  const updated = await ctx.env.DB.prepare('SELECT * FROM subtasks WHERE id = ?').bind(id).first();
  if (!updated) return json({ error: 'Not found' }, 404);
  return json(updated);
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  if (!(await ownsSubtask(ctx, id))) return json({ error: 'Only the owner can edit this task' }, 403);
  await ctx.env.DB.prepare('DELETE FROM subtasks WHERE id = ?').bind(id).run();
  return json({ ok: true });
};
