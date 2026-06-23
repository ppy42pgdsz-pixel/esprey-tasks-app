/**
 * GET  /api/users — list employees (any signed-in user, for sharing pickers)
 * POST /api/users — add an employee { name, email, role } (admin only)
 */

import { grantAccess } from './_cf';

interface Env {
  DB: D1Database;
  ADMIN_EMAIL: string;
  ADMIN_NAME?: string;
  APP_DOMAIN?: string;
  RESEND_API_KEY?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Send the welcome/intro email to a newly added employee. No-ops if Resend isn't configured. */
async function sendWelcomeEmail(env: Env, to: { name: string; email: string }): Promise<void> {
  if (!env.RESEND_API_KEY) return; // not wired up yet — adding still works
  const adminName = env.ADMIN_NAME ?? 'the admin';
  const appUrl = `https://${env.APP_DOMAIN ?? 'tasks.esprey.net'}`;
  const firstName = to.name.trim().split(/\s+/)[0] || to.name;

  const text = `Hi ${firstName},

You've been added to Esprey Tasks — the shared to-do and follow-up tool we use to keep track of what needs doing across the team.

HOW TO LOG IN
Go to ${appUrl} and sign in with this email address (${to.email}). You'll get a one-time code by email to confirm it's you — no password to remember.

HOW IT'S ORGANISED
- Your work is grouped into projects. Each project holds one or more tasks — the individual to-dos.
- Forward any email to tasks@esprey.net and it becomes a project automatically, with the tasks pulled out for you. It must come from an email address registered to you — anything from an unregistered address bounces back. You can register as many addresses as you need (personal, work domains, etc.); just contact ${adminName} to add them.
- You can also create a project yourself: give it a title and add tasks, or paste in some notes and let the app draft the tasks for you.

WORKING WITH OTHERS
- Projects you create are private to you. Someone else only sees a project once you assign them a task in it — and they see just the tasks assigned to them, not the rest.
- When you finish a task assigned to you, mark it Done. It goes back to the project owner to sign off — they either accept it or send it back with a note if something's still needed.
- Tagging a company on a project is just a label for filtering; it doesn't share anything.
- Each morning you'll get a short email summarising what's on your plate: tasks awaiting your sign-off, tasks assigned to you, and anything due soon. Nothing pending, no email.

KEEPING IT TIDY
- Once a project is complete it moves to the Completed view. Completed projects are automatically removed after one month, so your list stays focused on what's still live.
- Not even the admin can see your private projects.

${adminName} manages the team — just reply with any questions.

Welcome aboard,
${adminName}`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1c1917;line-height:1.55;">
  <p>Hi ${firstName},</p>
  <p>You've been added to <strong>Esprey Tasks</strong> — the shared to-do and follow-up tool we use to keep track of what needs doing across the team.</p>
  <p><strong>How to log in</strong><br>Go to <a href="${appUrl}">${appUrl}</a> and sign in with this email address (${to.email}). You'll get a one-time code by email to confirm it's you — no password to remember.</p>
  <p><strong>How it's organised</strong></p>
  <ul>
    <li>Your work is grouped into <strong>projects</strong>. Each project holds one or more <strong>tasks</strong> — the individual to-dos.</li>
    <li>Forward any email to <strong>tasks@esprey.net</strong> and it becomes a project automatically, with the tasks pulled out for you. It must come from an email address registered to you — anything from an <strong>unregistered address bounces back</strong>. You can register as many addresses as you need (personal, work domains, etc.); just contact ${adminName} to add them.</li>
    <li>You can also create a project yourself: give it a title and add tasks, or paste in some notes and let the app draft the tasks for you.</li>
  </ul>
  <p><strong>Working with others</strong></p>
  <ul>
    <li>Projects you create are <strong>private to you</strong>. Someone else only sees a project once you <strong>assign them a task</strong> in it — and they see just the tasks assigned to them, not the rest.</li>
    <li>When you finish a task assigned to you, mark it <strong>Done</strong>. It goes back to the project owner to sign off — they either accept it or send it back with a note if something's still needed.</li>
    <li>Tagging a company on a project is just a label for filtering; it doesn't share anything.</li>
    <li>Each morning you'll get a short email summarising what's on your plate: tasks awaiting your sign-off, tasks assigned to you, and anything due soon. Nothing pending, no email.</li>
  </ul>
  <p><strong>Keeping it tidy</strong></p>
  <ul>
    <li>Once a project is complete it moves to the <strong>Completed</strong> view. Completed projects are <strong>automatically removed after one month</strong>, so your list stays focused on what's still live.</li>
    <li>Not even the admin can see your private projects.</li>
  </ul>
  <p>${adminName} manages the team — just reply with any questions.</p>
  <p>Welcome aboard,<br>${adminName}</p>
</div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Esprey Tasks <tasks@esprey.net>',
        to: [to.email],
        reply_to: env.ADMIN_EMAIL,
        subject: "You've been added to the Esprey Tasks app",
        text,
        html,
      }),
    });
  } catch (e) {
    console.error('welcome email failed:', e);
  }
}

async function isAdmin(ctx: EventContext<Env, string, Record<string, unknown>>): Promise<boolean> {
  const email = ((ctx.data as { userEmail?: string }).userEmail ?? '').toLowerCase();
  if (!email) return false;
  if (email === (ctx.env.ADMIN_EMAIL ?? '').toLowerCase()) return true;
  const row = await ctx.env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first<{ role: string }>();
  return row?.role === 'admin';
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { results: users } = await ctx.env.DB.prepare(
    'SELECT email, name, role, created_at FROM users ORDER BY name ASC',
  ).all<{ email: string; name: string; role: string; created_at: number }>();
  const { results: aliases } = await ctx.env.DB.prepare(
    'SELECT alias_email, user_email FROM user_aliases',
  ).all<{ alias_email: string; user_email: string }>();
  const { results: companies } = await ctx.env.DB.prepare(
    'SELECT user_email, company_id FROM user_companies',
  ).all<{ user_email: string; company_id: string }>();
  const out = users.map((u) => ({
    ...u,
    aliases: aliases
      .filter((a) => a.user_email.toLowerCase() === u.email.toLowerCase())
      .map((a) => a.alias_email),
    company_ids: companies
      .filter((c) => c.user_email.toLowerCase() === u.email.toLowerCase())
      .map((c) => c.company_id),
  }));
  return json(out);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  if (!(await isAdmin(ctx))) return json({ error: 'Admin only' }, 403);

  const body = await ctx.request.json<{ name: string; email: string; role?: string }>();
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const role = body.role === 'admin' ? 'admin' : 'member';
  if (!name || !email) return json({ error: 'name and email are required' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid email' }, 400);

  await ctx.env.DB.prepare(
    'INSERT OR REPLACE INTO users (email, name, role, created_at) VALUES (?, ?, ?, ?)',
  ).bind(email, name, role, Date.now()).run();

  // Let them sign in: add their email to the Access policy. Roll back on failure.
  try {
    await grantAccess(ctx.env, email);
  } catch (e) {
    await ctx.env.DB.prepare('DELETE FROM users WHERE email = ?').bind(email).run();
    return json({ error: `Cloudflare Access update failed: ${(e as Error).message}` }, 500);
  }

  const user = await ctx.env.DB.prepare('SELECT email, name, role, created_at FROM users WHERE email = ?').bind(email).first();

  // Send the intro email (no-ops if Resend isn't configured). Doesn't block the add on failure.
  await sendWelcomeEmail(ctx.env, { name, email });

  return json(user, 201);
};
