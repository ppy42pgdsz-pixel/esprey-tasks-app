/**
 * PATCH  /api/subtasks/:id — update a subtask { text?, done? }
 * DELETE /api/subtasks/:id — delete a subtask
 */

interface Env { DB: D1Database }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

type SubStatus = 'todo' | 'in_progress' | 'done';

export const onRequestPatch: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const body = await ctx.request.json<{ text?: string; done?: boolean; status?: SubStatus }>();

  const updates: string[] = [];
  const values: unknown[] = [];

  if ('text' in body) {
    const text = body.text?.trim();
    if (!text) return json({ error: 'text cannot be empty' }, 400);
    updates.push('text = ?');
    values.push(text.slice(0, 300));
  }
  if ('status' in body) {
    const status: SubStatus = body.status === 'in_progress' || body.status === 'done' ? body.status : 'todo';
    updates.push('status = ?');
    values.push(status);
    updates.push('done = ?'); // keep the legacy flag in sync
    values.push(status === 'done' ? 1 : 0);
  } else if ('done' in body) {
    updates.push('done = ?');
    values.push(body.done ? 1 : 0);
    updates.push('status = ?');
    values.push(body.done ? 'done' : 'todo');
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
  await ctx.env.DB.prepare('DELETE FROM subtasks WHERE id = ?').bind(id).run();
  return json({ ok: true });
};
