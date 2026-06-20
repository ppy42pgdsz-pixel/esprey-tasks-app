/**
 * GET /api/admin/send-digest?confirm=yes[&all=yes] — admin-only manual run of
 * the daily digest, for testing. Default sends only to the admin (a preview of
 * their own digest); &all=yes sends everyone theirs. Mirrors the worker cron.
 */
import { meFromCtx, isAdminEmail, json } from '../_lib';

interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  ADMIN_EMAIL: string;
  APP_DOMAIN?: string;
}

const DUE_SOON_MS = 3 * 24 * 60 * 60 * 1000;
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dueLabel = (ms: number, now: number) => (ms < now ? `${fmtDate(ms)} (overdue)` : fmtDate(ms));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function buildAndSend(env: Env, user: { email: string; name: string }, appUrl: string): Promise<boolean> {
  const now = Date.now();
  const email = user.email.toLowerCase();

  const { results: awaiting } = await env.DB.prepare(
    `SELECT t.title AS task_title, s.text AS subtask_text
     FROM subtasks s JOIN tasks t ON t.id = s.task_id
     WHERE t.owner_email = ? AND s.status = 'done' AND s.accepted_at IS NULL ORDER BY t.title`,
  ).bind(email).all<{ task_title: string; subtask_text: string }>();

  const { results: assigned } = await env.DB.prepare(
    `SELECT t.title AS task_title, s.text AS subtask_text, s.due_date AS due_date
     FROM subtask_assignees sa JOIN subtasks s ON s.id = sa.subtask_id JOIN tasks t ON t.id = s.task_id
     WHERE sa.user_email = ? AND s.accepted_at IS NULL ORDER BY (s.due_date IS NULL), s.due_date`,
  ).bind(email).all<{ task_title: string; subtask_text: string; due_date: number | null }>();

  const { results: dueTasks } = await env.DB.prepare(
    `SELECT title, due_date FROM tasks
     WHERE owner_email = ? AND status != 'done' AND completed_at IS NULL AND due_date IS NOT NULL AND due_date <= ?
     ORDER BY due_date`,
  ).bind(email, now + DUE_SOON_MS).all<{ title: string; due_date: number }>();

  if (!awaiting.length && !assigned.length && !dueTasks.length) return false;

  const firstName = (user.name || '').trim().split(/\s+/)[0] || 'there';
  const html: string[] = [`<p>Hi ${firstName},</p><p>Here's your Esprey Tasks summary for today.</p>`];
  if (awaiting.length) html.push(`<p><strong>Awaiting your sign-off (${awaiting.length})</strong></p><ul>${awaiting.map((a) => `<li>${esc(a.subtask_text)} — <em>${esc(a.task_title)}</em></li>`).join('')}</ul>`);
  if (assigned.length) html.push(`<p><strong>Assigned to you (${assigned.length})</strong></p><ul>${assigned.map((a) => `<li>${esc(a.subtask_text)} — <em>${esc(a.task_title)}</em>${a.due_date ? ` <span style="color:#5b21b6">(due ${dueLabel(a.due_date, now)})</span>` : ''}</li>`).join('')}</ul>`);
  if (dueTasks.length) html.push(`<p><strong>Your tasks due soon (${dueTasks.length})</strong></p><ul>${dueTasks.map((d) => `<li>${esc(d.title)} — <span style="color:#5b21b6">due ${dueLabel(d.due_date, now)}</span></li>`).join('')}</ul>`);
  html.push(`<p><a href="${appUrl}">Open Esprey Tasks</a></p>`);

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Esprey Tasks <tasks@esprey.net>',
      to: [user.email],
      reply_to: env.ADMIN_EMAIL,
      subject: 'Your Esprey Tasks summary',
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1c1917;line-height:1.55;">${html.join('')}</div>`,
    }),
  });
  return true;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await isAdminEmail(ctx.env.DB, me, ctx.env.ADMIN_EMAIL))) return json({ error: 'Admin only' }, 403);

  const url = new URL(ctx.request.url);
  if (url.searchParams.get('confirm') !== 'yes') return json({ error: 'Add ?confirm=yes to run. Optional &all=yes to send everyone theirs.' }, 400);
  if (!ctx.env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY not configured' }, 500);

  const appUrl = `https://${ctx.env.APP_DOMAIN ?? 'tasks.esprey.net'}`;
  const everyone = url.searchParams.get('all') === 'yes';
  const recipients = everyone
    ? (await ctx.env.DB.prepare('SELECT email, name FROM users').all<{ email: string; name: string }>()).results
    : (await ctx.env.DB.prepare('SELECT email, name FROM users WHERE email = ?').bind(me).all<{ email: string; name: string }>()).results;

  let sent = 0;
  const skipped: string[] = [];
  for (const u of recipients) {
    try { (await buildAndSend(ctx.env, u, appUrl)) ? sent++ : skipped.push(u.email); }
    catch (e) { console.error('digest send failed', u.email, e); }
  }
  return json({ sent, skipped, recipients: recipients.length });
};
