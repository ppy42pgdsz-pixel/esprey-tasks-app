/**
 * POST /api/tasks/:id/draft-reply
 * Uses Claude to generate a draft email reply for email-sourced tasks.
 * Saves the draft to the task and returns it.
 */

import { meFromCtx, isTaskOwner } from '../../_lib';

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  ADMIN_NAME: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  from_email: string | null;
  from_name: string | null;
  original_subject: string | null;
  original_body: string | null;
  draft_reply: string | null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await isTaskOwner(ctx.env.DB, id, me))) return json({ error: 'Only the owner can do this' }, 403);
  const task = await ctx.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<Task>();

  if (!task) return json({ error: 'Not found' }, 404);

  if (!task.original_body && !task.description) {
    return json({ error: 'No email content to reply to' }, 400);
  }

  const prompt = `You are drafting an email reply on behalf of ${ctx.env.ADMIN_NAME}.

Original email details:
From: ${task.from_name ?? 'Unknown'} <${task.from_email ?? 'unknown'}>
Subject: ${task.original_subject ?? task.title}

Email body:
${task.original_body ?? task.description}

Task summary: ${task.title}
${task.description ? `Additional notes: ${task.description}` : ''}

Write a professional, concise draft reply. Use a friendly but efficient tone.
Sign off as ${ctx.env.ADMIN_NAME}.
Output ONLY the email body — no subject line, no "Here is a draft:" preamble.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ctx.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    return json({ error: 'Claude API error' }, 502);
  }

  const result = await response.json<{ content: Array<{ type: string; text: string }> }>();
  const draftReply = result.content.find((c) => c.type === 'text')?.text ?? '';

  await ctx.env.DB.prepare(
    'UPDATE tasks SET draft_reply = ?, updated_at = ? WHERE id = ?'
  )
    .bind(draftReply, Date.now(), id)
    .run();

  return json({ draft_reply: draftReply });
};
