/**
 * Shared logic for the Claude command box: build the user's context, define the
 * curated set of actions Claude may propose, and execute approved actions
 * against the DB (owner-scoped). Claude never touches the DB directly — it only
 * proposes actions from this menu, which the app validates and runs.
 */

import { notify, logEvent } from '../_lib';
import { pushToUser, type WebPushEnv } from '../_webpush';

type Env = WebPushEnv;

export type AssistantAction =
  | { type: 'create_project'; title: string; company_name?: string; tasks?: string[] }
  | { type: 'rename_project'; project_id: string; title: string }
  | { type: 'add_tasks'; project_id: string; tasks: string[] }
  | { type: 'move_tasks'; task_ids: string[]; to_project_id: string }
  | { type: 'merge_projects'; source_project_ids: string[]; target_project_id?: string; new_title?: string }
  | { type: 'assign_tasks'; task_ids: string[]; assignee_emails: string[] }
  | { type: 'set_task_due'; task_ids: string[]; due_date: string | null }
  | { type: 'set_task_status'; task_ids: string[]; status: 'todo' | 'in_progress' | 'done' }
  | { type: 'delete_project'; project_id: string };

function nanoid() { return crypto.randomUUID().replace(/-/g, '').slice(0, 21); }

/** Compact snapshot of the user's projects/tasks + team, for the prompt. */
export async function loadContext(db: D1Database, me: string) {
  const out = [] as Array<{ id: string; title: string; company: string | null; owned: boolean; owner_name?: string | null; tasks: Array<{ id: string; text: string }> }>;

  // Projects the user owns — full task list, full edit rights.
  const { results: owned } = await db
    .prepare("SELECT id, title, company_name FROM tasks WHERE owner_email = ? AND status != 'done' AND completed_at IS NULL ORDER BY created_at DESC LIMIT 100")
    .bind(me)
    .all<{ id: string; title: string; company_name: string | null }>();
  for (const p of owned) {
    const { results: subs } = await db
      .prepare('SELECT id, text FROM subtasks WHERE task_id = ? ORDER BY position ASC, created_at ASC LIMIT 60')
      .bind(p.id)
      .all<{ id: string; text: string }>();
    out.push({ id: p.id, title: p.title, company: p.company_name, owned: true, tasks: subs });
  }

  // Projects owned by others where the user is assigned tasks — only their tasks,
  // and only status changes are allowed.
  const { results: assigned } = await db
    .prepare(
      `SELECT DISTINCT t.id, t.title, t.company_name, u.name AS owner_name
       FROM tasks t JOIN subtasks s ON s.task_id = t.id JOIN subtask_assignees sa ON sa.subtask_id = s.id
       LEFT JOIN users u ON u.email = t.owner_email
       WHERE sa.user_email = ? AND LOWER(t.owner_email) != ? AND t.status != 'done' AND t.completed_at IS NULL
       ORDER BY t.created_at DESC LIMIT 100`,
    )
    .bind(me, me)
    .all<{ id: string; title: string; company_name: string | null; owner_name: string | null }>();
  for (const p of assigned) {
    const { results: subs } = await db
      .prepare('SELECT id, text FROM subtasks WHERE task_id = ? AND id IN (SELECT subtask_id FROM subtask_assignees WHERE user_email = ?) ORDER BY position ASC, created_at ASC LIMIT 60')
      .bind(p.id, me)
      .all<{ id: string; text: string }>();
    out.push({ id: p.id, title: p.title, company: p.company_name, owned: false, owner_name: p.owner_name, tasks: subs });
  }

  const { results: team } = await db.prepare('SELECT name, email FROM users ORDER BY name').all<{ name: string; email: string }>();
  return { projects: out, team };
}

// ─── execution helpers ───
async function ownsProject(db: D1Database, me: string, projectId: string): Promise<boolean> {
  const r = await db.prepare('SELECT owner_email FROM tasks WHERE id = ?').bind(projectId).first<{ owner_email: string | null }>();
  return !!r && (r.owner_email ?? '').toLowerCase() === me;
}
async function ownsSubtask(db: D1Database, me: string, subtaskId: string): Promise<boolean> {
  const s = await db.prepare('SELECT task_id FROM subtasks WHERE id = ?').bind(subtaskId).first<{ task_id: string }>();
  if (!s) return false;
  return ownsProject(db, me, s.task_id);
}
async function resolveCompany(db: D1Database, name?: string): Promise<{ id: string | null; name: string | null }> {
  if (!name) return { id: null, name: null };
  const c = await db.prepare('SELECT id, name FROM companies WHERE LOWER(name) = LOWER(?)').bind(name).first<{ id: string; name: string }>();
  return c ? { id: c.id, name: c.name } : { id: null, name };
}
async function nextPosition(db: D1Database, projectId: string): Promise<number> {
  const r = await db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM subtasks WHERE task_id = ?').bind(projectId).first<{ next: number }>();
  return r?.next ?? 0;
}

/** Run the approved actions. Returns a human-readable result line per action. */
export async function executeActions(env: Env, me: string, actions: AssistantAction[]): Promise<string[]> {
  const db = env.DB;
  const results: string[] = [];
  const now = Date.now();

  for (const a of actions) {
    try {
      switch (a.type) {
        case 'create_project': {
          const id = nanoid();
          const comp = await resolveCompany(db, a.company_name);
          await db.prepare(
            `INSERT INTO tasks (id, title, description, status, priority, source, owner_email, visibility, created_at, updated_at, company_id, company_name)
             VALUES (?, ?, '', 'todo', 'normal', 'manual', ?, 'private', ?, ?, ?, ?)`,
          ).bind(id, a.title.trim() || 'Untitled', me, now, now, comp.id, comp.name).run();
          let pos = 0;
          for (const t of a.tasks ?? []) {
            if (!t.trim()) continue;
            await db.prepare('INSERT INTO subtasks (id, task_id, text, done, status, position, created_at) VALUES (?, ?, ?, 0, \'todo\', ?, ?)').bind(nanoid(), id, t.trim().slice(0, 300), pos++, now).run();
          }
          results.push(`Created project "${a.title}"${a.tasks?.length ? ` with ${a.tasks.length} task(s)` : ''}.`);
          break;
        }
        case 'rename_project': {
          if (!(await ownsProject(db, me, a.project_id))) { results.push('Skipped a rename (project not found).'); break; }
          await db.prepare('UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?').bind(a.title.trim(), now, a.project_id).run();
          results.push(`Renamed a project to "${a.title}".`);
          break;
        }
        case 'add_tasks': {
          if (!(await ownsProject(db, me, a.project_id))) { results.push('Skipped adding tasks (project not found).'); break; }
          let pos = await nextPosition(db, a.project_id);
          let n = 0;
          for (const t of a.tasks ?? []) {
            if (!t.trim()) continue;
            await db.prepare('INSERT INTO subtasks (id, task_id, text, done, status, position, created_at) VALUES (?, ?, ?, 0, \'todo\', ?, ?)').bind(nanoid(), a.project_id, t.trim().slice(0, 300), pos++, now).run();
            n++;
          }
          results.push(`Added ${n} task(s).`);
          break;
        }
        case 'move_tasks': {
          if (!(await ownsProject(db, me, a.to_project_id))) { results.push('Skipped a move (target project not found).'); break; }
          let n = 0;
          for (const tid of a.task_ids ?? []) {
            if (!(await ownsSubtask(db, me, tid))) continue;
            await db.batch([
              db.prepare('UPDATE subtasks SET task_id = ? WHERE id = ?').bind(a.to_project_id, tid),
              db.prepare('UPDATE task_attachments SET task_id = ? WHERE subtask_id = ?').bind(a.to_project_id, tid),
            ]);
            n++;
          }
          results.push(`Moved ${n} task(s).`);
          break;
        }
        case 'merge_projects': {
          let target = a.target_project_id;
          if (target && !(await ownsProject(db, me, target))) target = undefined;
          if (!target) {
            target = nanoid();
            await db.prepare(
              `INSERT INTO tasks (id, title, description, status, priority, source, owner_email, visibility, created_at, updated_at)
               VALUES (?, ?, '', 'todo', 'normal', 'manual', ?, 'private', ?, ?)`,
            ).bind(target, (a.new_title || 'Merged project').trim(), me, now, now).run();
          } else if (a.new_title) {
            await db.prepare('UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?').bind(a.new_title.trim(), now, target).run();
          }
          let merged = 0;
          for (const src of a.source_project_ids ?? []) {
            if (src === target || !(await ownsProject(db, me, src))) continue;
            await db.batch([
              db.prepare('UPDATE subtasks SET task_id = ? WHERE task_id = ?').bind(target, src),
              db.prepare('UPDATE task_attachments SET task_id = ? WHERE task_id = ?').bind(target, src),
              db.prepare('DELETE FROM task_events WHERE task_id = ?').bind(src),
              db.prepare('DELETE FROM task_shares WHERE task_id = ?').bind(src),
              db.prepare('DELETE FROM notifications WHERE task_id = ?').bind(src),
              db.prepare('DELETE FROM tasks WHERE id = ?').bind(src),
            ]);
            merged++;
          }
          results.push(`Merged ${merged} project(s)${a.new_title ? ` into "${a.new_title}"` : ''}.`);
          break;
        }
        case 'assign_tasks': {
          const emails = Array.from(new Set((a.assignee_emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)));
          let n = 0;
          for (const tid of a.task_ids ?? []) {
            if (!(await ownsSubtask(db, me, tid))) continue;
            const stmts = [db.prepare('DELETE FROM subtask_assignees WHERE subtask_id = ?').bind(tid)];
            for (const e of emails) stmts.push(db.prepare('INSERT OR IGNORE INTO subtask_assignees (subtask_id, user_email) VALUES (?, ?)').bind(tid, e));
            await db.batch(stmts);
            n++;
          }
          results.push(`Assigned ${n} task(s).`);
          break;
        }
        case 'set_task_due': {
          const ms = a.due_date ? Date.parse(`${a.due_date}T00:00:00Z`) : null;
          let n = 0;
          for (const tid of a.task_ids ?? []) {
            if (!(await ownsSubtask(db, me, tid))) continue;
            await db.prepare('UPDATE subtasks SET due_date = ? WHERE id = ?').bind(Number.isFinite(ms as number) ? ms : null, tid).run();
            n++;
          }
          results.push(`Updated due date on ${n} task(s).`);
          break;
        }
        case 'set_task_status': {
          const status = a.status === 'in_progress' || a.status === 'done' ? a.status : 'todo';
          let n = 0;
          for (const tid of a.task_ids ?? []) {
            const sub = await db.prepare('SELECT task_id, text FROM subtasks WHERE id = ?').bind(tid).first<{ task_id: string; text: string }>();
            if (!sub) continue;
            const owner = await ownsProject(db, me, sub.task_id);
            const assignee = owner ? false : !!(await db.prepare('SELECT 1 FROM subtask_assignees WHERE subtask_id = ? AND user_email = ?').bind(tid, me).first());
            if (!owner && !assignee) continue; // can only act on own or assigned tasks
            // The owner's "done" auto-accepts; an assignee's "done" awaits sign-off.
            const acceptedAt = status === 'done' && owner ? now : null;
            await db.prepare('UPDATE subtasks SET status = ?, done = ?, accepted_at = ? WHERE id = ?')
              .bind(status, status === 'done' ? 1 : 0, acceptedAt, tid).run();
            n++;
            // Assignee marking done → notify the project owner (same as the UI flow).
            if (status === 'done' && assignee) {
              const proj = await db.prepare('SELECT title, owner_email FROM tasks WHERE id = ?').bind(sub.task_id).first<{ title: string; owner_email: string | null }>();
              const meName = (await db.prepare('SELECT name FROM users WHERE email = ?').bind(me).first<{ name: string }>())?.name ?? me.split('@')[0];
              const label = sub.text.slice(0, 120);
              await logEvent(db, sub.task_id, me, 'subtask_done', `Marked done (awaiting sign-off): ${label}`);
              await notify(db, proj?.owner_email, 'task_done', 'Task done', `${meName} marked "${label}" done`, sub.task_id, tid);
              await pushToUser(env, proj?.owner_email, { title: 'Task done', body: `${meName} marked "${label}" done`, url: `/?task=${sub.task_id}`, tag: `${tid}-done` });
            }
          }
          results.push(`Set status on ${n} task(s).`);
          break;
        }
        case 'delete_project': {
          if (!(await ownsProject(db, me, a.project_id))) { results.push('Skipped a delete (project not found).'); break; }
          await db.batch([
            db.prepare('DELETE FROM subtask_comments WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)').bind(a.project_id),
            db.prepare('DELETE FROM subtask_assignees WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)').bind(a.project_id),
            db.prepare('DELETE FROM subtasks WHERE task_id = ?').bind(a.project_id),
            db.prepare('DELETE FROM task_attachments WHERE task_id = ?').bind(a.project_id),
            db.prepare('DELETE FROM task_events WHERE task_id = ?').bind(a.project_id),
            db.prepare('DELETE FROM task_shares WHERE task_id = ?').bind(a.project_id),
            db.prepare('DELETE FROM notifications WHERE task_id = ?').bind(a.project_id),
            db.prepare('DELETE FROM tasks WHERE id = ?').bind(a.project_id),
          ]);
          results.push('Deleted a project.');
          break;
        }
        default:
          results.push('Skipped an unrecognised action.');
      }
    } catch (e) {
      results.push(`An action failed: ${(e as Error).message}`);
    }
  }
  return results;
}
