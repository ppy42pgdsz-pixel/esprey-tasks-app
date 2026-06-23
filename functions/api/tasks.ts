/**
 * GET  /api/tasks        — list all tasks (sorted newest first)
 * POST /api/tasks        — create a task manually
 */

import { resolvePrimary, rawEmail, logEvent } from './_lib';

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

/** Today at UTC midnight (recurrence dates are calendar days, stored in UTC). */
function todayUtcMidnight(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
/** Advance a UTC-midnight date by N units (mirrors the worker helper). */
function addInterval(ms: number, unit: string, n: number): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear(), mo = d.getUTCMonth(), da = d.getUTCDate();
  if (unit === 'week') return Date.UTC(y, mo, da + 7 * n);
  if (unit === 'month') return Date.UTC(y, mo + n, da);
  return Date.UTC(y, mo, da + n);
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

  // "Completed for this viewer": the owner's task is done, OR a member has
  // assigned subtasks in it and every one of them has been signed off.
  const archived = `CASE WHEN t.owner_email = ? THEN (CASE WHEN t.status = 'done' THEN 1 ELSE 0 END)
    ELSE (CASE WHEN (SELECT COUNT(*) FROM subtask_assignees sa JOIN subtasks st ON st.id = sa.subtask_id WHERE st.task_id = t.id AND sa.user_email = ?) > 0
                AND (SELECT COUNT(*) FROM subtask_assignees sa JOIN subtasks st ON st.id = sa.subtask_id WHERE st.task_id = t.id AND sa.user_email = ? AND st.accepted_at IS NULL) = 0
           THEN 1 ELSE 0 END)
    END`;

  const conditions: string[] = [access];
  // Order of params must follow the order of `?` in the SQL string below:
  // the SELECT-clause subqueries come before the WHERE clause.
  const params: string[] = [
    me, me,        // subtask_total
    me, me,        // subtask_done
    me, me, me,    // archived CASE (owner check, has-assigned, open-count)
    me,            // assigned_to_me
    me, me, me,    // WHERE access (owner, shared, assigned)
  ];
  if (company_id) { conditions.push('t.company_id = ?'); params.push(company_id); }
  if (contact_id) { conditions.push('t.contact_id = ?'); params.push(contact_id); }

  const query = `SELECT t.*, u.name AS owner_name,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND ${visibleSub}) AS subtask_total,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.status = 'done' AND ${visibleSub}) AS subtask_done,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.status = 'done' AND s.accepted_at IS NULL) AS pending_signoff,
    ${archived} AS archived,
    (SELECT GROUP_CONCAT(DISTINCT u2.name) FROM subtask_assignees sa JOIN subtasks st ON st.id = sa.subtask_id JOIN users u2 ON u2.email = sa.user_email WHERE st.task_id = t.id) AS assignee_names,
    (SELECT GROUP_CONCAT(DISTINCT c.name) FROM subtask_contacts sc JOIN subtasks st ON st.id = sc.subtask_id JOIN contacts c ON c.id = sc.contact_id WHERE st.task_id = t.id) AS assigned_contact_names,
    (SELECT MIN(st.due_date) FROM subtasks st WHERE st.task_id = t.id AND st.accepted_at IS NULL AND st.due_date IS NOT NULL) AS min_subtask_due,
    (SELECT COUNT(*) FROM subtask_assignees sa JOIN subtasks st ON st.id = sa.subtask_id WHERE st.task_id = t.id AND sa.user_email = ?) AS assigned_to_me
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
    recur_interval?: number;
    recur_unit?: string;
    recur_next_at?: number;
  }>();

  if (!body.title?.trim()) {
    return json({ error: 'title is required' }, 400);
  }

  const now = Date.now();
  const id = nanoid();
  const me = await resolvePrimary(ctx.env.DB, rawEmail(ctx));
  const visibility = body.visibility === 'shared' ? 'shared' : 'private';

  // Recurrence (optional). If a valid unit is given, default the next occurrence
  // to one interval from today unless the caller specifies an explicit date.
  const recurUnit = ['day', 'week', 'month'].includes(body.recur_unit ?? '') ? body.recur_unit! : null;
  const recurInterval = recurUnit ? Math.max(1, Math.floor(body.recur_interval ?? 1)) : null;
  const recurNextAt = recurUnit
    ? (body.recur_next_at ?? addInterval(todayUtcMidnight(), recurUnit, recurInterval!))
    : null;

  await ctx.env.DB.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, source, owner_email, visibility, created_at, updated_at, due_date, company_id, company_name, contact_id, contact_name, recur_interval, recur_unit, recur_next_at)
     VALUES (?, ?, ?, 'todo', ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      recurInterval,
      recurUnit,
      recurNextAt,
    )
    .run();

  // Share on create.
  if (visibility === 'shared') {
    const emails = Array.from(new Set((body.share_emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean).filter((e) => e !== me)));
    if (emails.length) {
      await ctx.env.DB.batch(emails.map((e) => ctx.env.DB.prepare('INSERT OR IGNORE INTO task_shares (task_id, user_email) VALUES (?, ?)').bind(id, e)));
    }
  }

  await logEvent(ctx.env.DB, id, me, 'created', recurUnit ? 'Task created (repeating)' : 'Task created');

  const task = await ctx.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  return json(task, 201);
};
