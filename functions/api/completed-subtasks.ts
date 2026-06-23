/**
 * GET /api/completed-subtasks — every signed-off (accepted) subtask the viewer
 * is entitled to see: ones in tasks they own, plus ones assigned to them.
 * Used by the "Completed" tab to surface finished subtasks across all tasks,
 * including those whose parent task is still active.
 */

import { meFromCtx } from './_lib';

interface Env { DB: D1Database }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);

  const { results } = await ctx.env.DB.prepare(
    `SELECT s.id, s.task_id, s.text, s.accepted_at, s.completion_note, s.due_date,
            t.title AS task_title, t.company_name, t.company_id,
            (SELECT GROUP_CONCAT(DISTINCT u2.name)
               FROM subtask_assignees sa2 JOIN users u2 ON u2.email = sa2.user_email
               WHERE sa2.subtask_id = s.id) AS assignee_names
     FROM subtasks s
     JOIN tasks t ON t.id = s.task_id
     WHERE s.accepted_at IS NOT NULL
       AND (
         t.owner_email = ?
         OR EXISTS (SELECT 1 FROM subtask_assignees sa WHERE sa.subtask_id = s.id AND sa.user_email = ?)
       )
     ORDER BY s.accepted_at DESC`,
  ).bind(me, me).all();

  return json(results);
};
