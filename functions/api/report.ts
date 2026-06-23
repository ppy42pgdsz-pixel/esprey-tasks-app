/**
 * GET  /api/report[?company_id=…]  — outstanding (active) projects you own plus
 *                                      their open tasks. Used by the Reports screen.
 * POST /api/report  { company_id? } — email that same report to you (via Resend).
 */

import { meFromCtx, json } from './_lib';
import { buildReport, fmtDate } from './reports/_shared';

interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  ADMIN_EMAIL: string;
  APP_DOMAIN?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  const companyId = new URL(ctx.request.url).searchParams.get('company_id');
  const projects = await buildReport(ctx.env.DB, me, companyId);
  return json({ generated_at: Date.now(), projects });
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!ctx.env.RESEND_API_KEY) return json({ error: 'Email isn\'t configured' }, 500);
  const body = await ctx.request.json<{ company_id?: string }>().catch(() => ({} as { company_id?: string }));
  const companyId = body.company_id ?? null;

  const projects = await buildReport(ctx.env.DB, me, companyId);
  const user = await ctx.env.DB.prepare('SELECT name FROM users WHERE email = ?').bind(me).first<{ name: string }>();
  const firstName = (user?.name || '').trim().split(/\s+/)[0] || 'there';
  const scope = companyId ? (projects[0]?.company_name ?? 'the selected company') : 'all companies';
  const appUrl = `https://${ctx.env.APP_DOMAIN ?? 'tasks.esprey.net'}`;

  const html: string[] = [
    `<p>Hi ${esc(firstName)},</p>`,
    `<p>Here are your outstanding projects and tasks (${esc(scope)}) as of ${fmtDate(Date.now())}.</p>`,
  ];
  if (projects.length === 0) {
    html.push('<p>Nothing outstanding — all clear. 🎉</p>');
  } else {
    for (const p of projects) {
      const meta = [p.company_name ? esc(p.company_name) : null, p.due_date ? `due ${fmtDate(p.due_date)}` : null].filter(Boolean).join(' · ');
      html.push(`<p style="margin:14px 0 4px"><strong>${esc(p.title)}</strong>${meta ? ` <span style="color:#78716c;font-size:13px">— ${meta}</span>` : ''}</p>`);
      if (p.tasks.length === 0) {
        html.push('<p style="margin:0 0 0 16px;color:#a8a29e;font-size:13px">No open tasks</p>');
      } else {
        html.push(`<ul style="margin:0 0 0 0">${p.tasks.map((t) => {
          const bits = [t.assignee_names ? esc(t.assignee_names) : 'Unassigned', t.due_date ? `due ${fmtDate(t.due_date)}` : null, t.status === 'done' ? 'awaiting sign-off' : null].filter(Boolean).join(' · ');
          return `<li>${esc(t.text)} <span style="color:#78716c;font-size:13px">(${bits})</span></li>`;
        }).join('')}</ul>`);
      }
    }
  }
  html.push(`<p style="margin-top:16px"><a href="${appUrl}">Open Esprey Tasks</a></p>`);

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Esprey Tasks <tasks@esprey.net>',
      to: [me],
      reply_to: ctx.env.ADMIN_EMAIL,
      subject: `Your outstanding tasks — ${scope}`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1c1917;line-height:1.55;">${html.join('')}</div>`,
    }),
  });

  return json({ ok: true, projects: projects.length });
};
