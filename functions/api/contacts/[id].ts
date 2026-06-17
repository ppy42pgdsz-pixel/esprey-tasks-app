/**
 * PATCH  /api/contacts/:id  — edit a contact (name, email, company, favourite)
 * DELETE /api/contacts/:id  — delete a contact; unassigns it from tasks but keeps the tasks
 */

interface Env { DB: D1Database }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPatch: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const body = await ctx.request.json<{
    name?: string;
    email?: string | null;
    company_id?: string | null;
    is_favourite?: boolean;
  }>();

  const existing = await ctx.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: 'Not found' }, 404);

  const updates: string[] = [];
  const values: unknown[] = [];

  if ('name' in body) {
    const name = body.name?.trim();
    if (!name) return json({ error: 'name cannot be empty' }, 400);
    updates.push('name = ?');
    values.push(name);
  }
  if ('email' in body) {
    updates.push('email = ?');
    values.push(body.email?.toString().trim() || null);
  }
  if ('company_id' in body) {
    updates.push('company_id = ?');
    values.push(body.company_id || null);
  }
  if ('is_favourite' in body) {
    updates.push('is_favourite = ?');
    values.push(body.is_favourite ? 1 : 0);
  }

  if (updates.length === 0) return json({ error: 'No valid fields to update' }, 400);

  const statements = [
    ctx.env.DB.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`).bind(...values, id),
  ];

  // Keep the denormalized contact_name on tasks in sync if the name changed.
  if ('name' in body) {
    statements.push(
      ctx.env.DB.prepare('UPDATE tasks SET contact_name = ? WHERE contact_id = ?').bind(body.name!.trim(), id),
    );
  }

  await ctx.env.DB.batch(statements);

  const contact = await ctx.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
  return json(contact);
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };

  // Unassign from tasks (keep contact_name as plain text), then delete the contact.
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE tasks SET contact_id = NULL WHERE contact_id = ?').bind(id),
    ctx.env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(id),
  ]);

  return json({ ok: true });
};
