/**
 * GET  /api/users — list employees (any signed-in user, for sharing pickers)
 * POST /api/users — add an employee { name, email, role } (admin only)
 */

interface Env {
  DB: D1Database;
  ADMIN_EMAIL: string;
  ADMIN_NAME?: string;
  APP_DOMAIN?: string;
  RESEND_API_KEY?: string;
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

WHAT IT DOES
- Keep your own to-do list, with priorities, notes, and sub-tasks.
- Forward any email to tasks@esprey.net from this address and it's turned into a task automatically. Emails from unregistered addresses are bounced, so always send from your work email.

WHAT'S PRIVATE AND WHAT'S SHARED
- Every task you create is private by default — only you can see it.
- A task only becomes visible to someone else if you explicitly share it. Shared tasks then appear on their list, marked as your task.
- Tagging a company or contact on a task is just a label — it does not share the task.
- On a task shared with you, you can add your own comments and mark it done; marking it done sends it back to the owner to accept or reopen.
- Not even the admin can see your private tasks.

${adminName} manages the team — just reply with any questions.

Welcome aboard,
${adminName}`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1c1917;line-height:1.55;">
  <p>Hi ${firstName},</p>
  <p>You've been added to <strong>Esprey Tasks</strong> — the shared to-do and follow-up tool we use to keep track of what needs doing across the team.</p>
  <p><strong>How to log in</strong><br>Go to <a href="${appUrl}">${appUrl}</a> and sign in with this email address (${to.email}). You'll get a one-time code by email to confirm it's you — no password to remember.</p>
  <p><strong>What it does</strong></p>
  <ul>
    <li>Keep your own to-do list, with priorities, notes, and sub-tasks.</li>
    <li>Forward any email to <strong>tasks@esprey.net</strong> from this address and it's turned into a task automatically. Emails from unregistered addresses are bounced, so always send from your work email.</li>
  </ul>
  <p><strong>What's private and what's shared</strong></p>
  <ul>
    <li>Every task you create is <strong>private by default</strong> — only you can see it.</li>
    <li>A task only becomes visible to someone else if <strong>you explicitly share it</strong>. Shared tasks then appear on their list, marked as your task.</li>
    <li>Tagging a company or contact on a task is just a label — it does <strong>not</strong> share the task.</li>
    <li>On a task shared with you, you can add your own comments and mark it done; marking it done sends it back to the owner to accept or reopen.</li>
    <li>Not even the admin can see your private tasks.</li>
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
  const withAliases = users.map((u) => ({
    ...u,
    aliases: aliases
      .filter((a) => a.user_email.toLowerCase() === u.email.toLowerCase())
      .map((a) => a.alias_email),
  }));
  return json(withAliases);
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

  const user = await ctx.env.DB.prepare('SELECT email, name, role, created_at FROM users WHERE email = ?').bind(email).first();

  // Send the intro email (no-ops if Resend isn't configured). Doesn't block the add on failure.
  await sendWelcomeEmail(ctx.env, { name, email });

  return json(user, 201);
};
