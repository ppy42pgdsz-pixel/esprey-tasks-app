/**
 * GET  /api/tasks        — list all tasks (sorted newest first)
 * POST /api/tasks        — create a task manually
 */

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function nanoid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 21);
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const status = url.searchParams.get('status');
  const company_id = url.searchParams.get('company_id');
  const contact_id = url.searchParams.get('contact_id');

  const conditions: string[] = [];
  const params: string[] = [];

  if (status) { conditions.push('status = ?'); params.push(status); }
  if (company_id) { conditions.push('company_id = ?'); params.push(company_id); }
  if (contact_id) { conditions.push('contact_id = ?'); params.push(contact_id); }

  let query = 'SELECT * FROM tasks';
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC';

  const { results } = await ctx.env.DB.prepare(query).bind(...params).all();
  return json(results);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const body = await ctx.request.json<{
    title: string;
    description?: string;
    priority?: string;
    due_date?: number;
    company_id?: string;
    company_name?: string;
    contact_id?: string;
    contact_name?: string;
  }>();

  if (!body.title?.trim()) {
    return json({ error: 'title is required' }, 400);
  }

  const now = Date.now();
  const id = nanoid();

  await ctx.env.DB.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, source, created_at, updated_at, due_date, company_id, company_name, contact_id, contact_name)
     VALUES (?, ?, ?, 'todo', ?, 'manual', ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.title.trim(),
      body.description ?? '',
      body.priority ?? 'normal',
      now,
      now,
      body.due_date ?? null,
      body.company_id ?? null,
      body.company_name ?? null,
      body.contact_id ?? null,
      body.contact_name ?? null,
    )
    .run();

  const task = await ctx.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  return json(task, 201);
};
