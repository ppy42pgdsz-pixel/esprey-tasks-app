/**
 * PATCH  /api/companies/:id  — rename a company (keeps denormalized task names in sync)
 * DELETE /api/companies/:id  — delete a company; fully unassigns it from tasks (clears id AND name) and from contacts, but keeps the tasks
 */

interface Env { DB: D1Database }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPatch: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const body = await ctx.request.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) return json({ error: 'name is required' }, 400);

  const existing = await ctx.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: 'Not found' }, 404);

  // Rename the company and keep the denormalized company_name on tasks in sync.
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE companies SET name = ? WHERE id = ?').bind(name, id),
    ctx.env.DB.prepare('UPDATE tasks SET company_name = ? WHERE company_id = ?').bind(name, id),
  ]);

  const company = await ctx.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first();
  return json(company);
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };

  // Fully unassign from tasks (clear both id and name) and from contacts, then delete the company.
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE tasks SET company_id = NULL, company_name = NULL WHERE company_id = ?').bind(id),
    ctx.env.DB.prepare('UPDATE contacts SET company_id = NULL WHERE company_id = ?').bind(id),
    ctx.env.DB.prepare('DELETE FROM companies WHERE id = ?').bind(id),
  ]);

  return json({ ok: true });
};
