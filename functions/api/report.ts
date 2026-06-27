/**
 * GET  /api/report[?company_id=…]  — outstanding (active) projects you own plus
 *                                      their open tasks. Used by the Reports screen.
 * POST /api/report  { company_id? } — email that same report to you (via Resend).
 */

import { meFromCtx, json } from './_lib';
import { buildReport, buildReportPdf, bucketReport, bytesToBase64, reportScope, fmtDate, type FlatTask } from './reports/_shared';

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
  const now = Date.now();
  const b = bucketReport(projects, now);
  const user = await ctx.env.DB.prepare('SELECT name FROM users WHERE email = ?').bind(me).first<{ name: string }>();
  const firstName = (user?.name || '').trim().split(/\s+/)[0] || 'there';
  const scope = await reportScope(ctx.env.DB, companyId);
  const appUrl = `https://${ctx.env.APP_DOMAIN ?? 'tasks.esprey.net'}`;

  // Each row: "task — project (who · due)".
  const row = (ft: FlatTask) => {
    const bits = [ft.assignees ? esc(ft.assignees) : 'Unassigned', ft.due ? `due ${fmtDate(ft.due)}` : null].filter(Boolean).join(' · ');
    return `<li style="margin:4px 0">${esc(ft.text)} <span style="color:#78716c;font-size:13px">— ${esc(ft.project)} (${esc(bits)})</span></li>`;
  };
  const section = (label: string, items: FlatTask[], color: string) =>
    items.length
      ? `<p style="margin:18px 0 4px;font-weight:700;color:${color}">${label} (${items.length})</p><ul style="margin:0;padding-left:18px">${items.map(row).join('')}</ul>`
      : '';

  const html: string[] = [
    `<p>Hi ${esc(firstName)},</p>`,
    `<p>Here's what needs you (${esc(scope)}) as of ${fmtDate(now)}. Your full outstanding checklist is attached as a PDF to print and tick off.</p>`,
    `<p style="font-size:14px;color:#44403c;background:#fafaf9;border:1px solid #ece9e6;border-radius:8px;padding:10px 12px">`
      + `<strong>${b.totalTasks}</strong> open task${b.totalTasks === 1 ? '' : 's'} across <strong>${b.totalProjects}</strong> project${b.totalProjects === 1 ? '' : 's'}`
      + `&nbsp;·&nbsp; <strong style="color:#b91c1c">${b.overdue.length}</strong> overdue`
      + `&nbsp;·&nbsp; <strong style="color:#b45309">${b.dueSoon.length}</strong> due this week`
      + (b.awaiting.length ? `&nbsp;·&nbsp; <strong>${b.awaiting.length}</strong> awaiting your sign-off` : '')
      + `</p>`,
  ];
  if (!b.overdue.length && !b.dueSoon.length && !b.awaiting.length) {
    html.push(projects.length === 0
      ? '<p>Nothing outstanding — all clear. 🎉</p>'
      : '<p>Nothing overdue, due this week, or awaiting your sign-off. 🎉 The attached PDF has your full outstanding list.</p>');
  } else {
    html.push(section('⚠ Overdue', b.overdue, '#b91c1c'));
    html.push(section('📅 Due this week', b.dueSoon, '#b45309'));
    html.push(section('✓ Awaiting your sign-off', b.awaiting, '#44403c'));
  }
  html.push(`<p style="margin-top:18px"><a href="${appUrl}">Open Esprey Tasks</a></p>`);

  // Build the print-and-tick PDF and attach it.
  let attachments: Array<{ filename: string; content: string }> = [];
  try {
    const pdfBytes = await buildReportPdf(projects, scope, now);
    attachments = [{ filename: `Outstanding tasks — ${scope} — ${fmtDate(now)}.pdf`, content: bytesToBase64(pdfBytes) }];
  } catch (e) {
    console.error('report PDF build failed; sending email without attachment', e);
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Esprey Tasks <tasks@esprey.net>',
      to: [me],
      reply_to: ctx.env.ADMIN_EMAIL,
      subject: `What needs you — ${scope}`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1c1917;line-height:1.55;">${html.join('')}</div>`,
      ...(attachments.length ? { attachments } : {}),
    }),
  });

  return json({ ok: true, projects: projects.length });
};
