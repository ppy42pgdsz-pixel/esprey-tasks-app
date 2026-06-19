/**
 * GET  /api/tasks        — list all tasks (sorted newest first)
 * POST /api/tasks        — create a task manually
 */

import { resolvePrimary, rawEmail } from './_lib';

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
  const me = await resolvePrimary(ctx.env.DB, rawEmail(ctx));
  const url = new URL(ctx.request.url);
  const company_id = url.searchParams.get('company_id');
  const contact_id = url.searchParams.get('contact_id');

  // Tasks I own, that are shared with me, OR where I'm assigned a subtask.
  // Subtask counts are scoped to the viewer: owners see all subtasks, while
  // a member assigned into the task sees only the subtasks assigned to them.
  const visibleSub = `(t.owner_email = ? OR EXISTS (SELECT 1 FROM subtask_assignees sa WHERE sa.subtask_id = s.id AND sa.user_email = ?))`;
  const access = `(t.owner_email = ?
    OR EXISTS (SELECT 1 FROM task_shares ts WHERE ts.task_id = t.id AND ts.user_email = ?)
    OR EXISTS (SELECT 1 FROM subtask_assignees sa JOIN subtasks st ON st.id = sa.subtask_id WHERE st.task_id = t.id AND sa.user_email = ?))`;

  const conditions: string[] = [access];
  // Order of params must follow the order of `?` in the SQL string below:
  // the two count subqueries (SELECT clause) come before the WHERE clause.
  const params: string[] = [me, me, me, me, me, me, me];
  if (company_id) { conditions.push('t.company_id = ?'); params.push(company_id); }
  if (contact_id) { conditions.push('t.contact_id = ?'); params.push(contact_id); }

  const query = `SELECT t.*, u.name AS owner_name,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND ${visibleSub}) AS subtask_total,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.status = 'done' AND ${visibleSub}) AS subtask_done,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.status = 'done' AND s.accepted_at IS NULL) AS pending_signoff
    FROM tasks t
    LEFT JOIN users u ON u.email = t.owner_email
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.created_at DESC`;

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
    visibility?: string;
    share_emails?: string[];
  }>();

  if (!body.title?.trim()) {
    return json({ error: 'title is required' }, 400);
  }

  const now = Date.now();
  const id = nanoid();
  const me = await resolvePrimary(ctx.env.DB, rawEmail(ctx));
  const visibility = body.visibility === 'shared' ? 'shared' : 'private';

  await ctx.env.DB.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, source, owner_email, visibility, created_at, updated_at, due_date, company_id, company_name, contact_id, contact_name)
     VALUES (?, ?, ?, 'todo', ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.title.trim(),
      body.description ?? '',
      body.priority ?? 'normal',
      me,
      visibility,
      now,
      now,
      body.due_date ?? null,
      body.company_id ?? null,
      body.company_name ?? null,
      body.contact_id ?? null,
      body.contact_name ?? null,
    )
    .run();

  // Share on create.
  if (visibility === 'shared') {
    const emails = Array.from(new Set((body.share_emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean).filter((e) => e !== me)));
    if (emails.length) {
      await ctx.env.DB.batch(emails.map((e) => ctx.env.DB.prepare('INSERT OR IGNORE INTO task_shares (task_id, user_email) VALUES (?, ?)').bind(id, e)));
    }
  }

  const task = await ctx.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  return json(task, 201);
};
