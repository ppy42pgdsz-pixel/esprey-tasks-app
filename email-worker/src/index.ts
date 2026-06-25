/**
 * Cloudflare Email Worker — esprey-tasks-email
 *
 * Triggered when an email arrives at tasks@esprey.net.
 * 1. Parses the raw MIME message with postal-mime
 * 2. Extracts attachments (images / PDFs / attached .eml emails)
 * 3. Sends the body + visual attachments to Claude to build a structured task
 * 4. Stores the original attachments in R2 and records them in task_attachments
 *
 * Auto-deploy: connected to GitHub via Cloudflare Workers Builds (root: email-worker).
 */

import PostalMime from 'postal-mime';
import { extractTask, type AiAttachment, type ParsedTask } from './anthropic';
import { toUint8, uint8ToBase64, extFromMime, nanoid, r2KeyForAttachment } from './util';

interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  ANTHROPIC_API_KEY: string;
  ADMIN_EMAIL: string;
  ADMIN_NAME: string;
  RESEND_API_KEY?: string;
  APP_DOMAIN?: string;
}

const AI_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** Is this attachment something we keep (real file, not an inline signature image)? */
function isWantedAttachment(att: { mimeType?: string; filename?: string; disposition?: string; contentId?: string }): boolean {
  const disposition = (att.disposition ?? '').toString().toLowerCase();
  if (disposition === 'inline') return false;
  if (att.contentId) return false;
  const mt = (att.mimeType ?? '').toLowerCase();
  if (mt.startsWith('image/')) return true;
  if (mt === 'application/pdf') return true;
  if (mt === 'message/rfc822') return true;
  if ((att.filename ?? '').toLowerCase().endsWith('.eml')) return true;
  return false;
}

/**
 * Resolve the forwarder's address to the owning employee's primary email
 * (alias-aware). Falls back to the admin until bounce-on-unregistered is wired.
 */
async function resolveOwner(db: D1Database, sender: string | undefined, adminEmail: string): Promise<string> {
  const e = (sender ?? '').toLowerCase();
  if (e) {
    const u = await db.prepare('SELECT email FROM users WHERE email = ?').bind(e).first<{ email: string }>();
    if (u) return u.email.toLowerCase();
    const a = await db.prepare('SELECT user_email FROM user_aliases WHERE alias_email = ?').bind(e).first<{ user_email: string }>();
    if (a) return a.user_email.toLowerCase();
  }
  return (adminEmail ?? '').toLowerCase();
}

const COMPLETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 1 month

/**
 * Delete tasks the owner completed more than a month ago, along with their
 * subtasks, assignments, shares, and attachments (including R2 objects).
 */
async function purgeOldCompleted(env: Env): Promise<number> {
  const cutoff = Date.now() - COMPLETED_RETENTION_MS;
  // Never purge a task that is still an active recurrence carrier — deleting it
  // would silently kill the series before it spawns its next occurrence.
  const { results: doomed } = await env.DB
    .prepare("SELECT id FROM tasks WHERE completed_at IS NOT NULL AND completed_at < ? AND (recur_unit IS NULL OR recur_active = 0)")
    .bind(cutoff)
    .all<{ id: string }>();
  if (!doomed.length) return 0;

  for (const { id } of doomed) {
    // Delete R2 objects for direct uploads only — library files own their object
    // (the library cleanup handles those). Collect referenced library files to
    // release after the task is gone.
    const { results: atts } = await env.DB
      .prepare('SELECT r2_key, library_file_id FROM task_attachments WHERE task_id = ?')
      .bind(id)
      .all<{ r2_key: string; library_file_id: string | null }>();
    for (const a of atts) {
      if (a.library_file_id) continue;
      try { await env.ATTACHMENTS.delete(a.r2_key); } catch (e) { console.error('R2 delete failed', a.r2_key, e); }
    }
    const libIds = Array.from(new Set(atts.map((a) => a.library_file_id).filter((x): x is string => !!x)));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM subtask_assignees WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)').bind(id),
      env.DB.prepare('DELETE FROM subtask_contacts WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)').bind(id),
      env.DB.prepare('DELETE FROM subtask_comments WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)').bind(id),
      env.DB.prepare('DELETE FROM subtasks WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM task_shares WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM task_attachments WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM task_events WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM notifications WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id),
    ]);
    // Any library file no longer referenced starts its 30-day orphan clock.
    for (const libId of libIds) {
      const used = await env.DB.prepare('SELECT 1 FROM task_attachments WHERE library_file_id = ? LIMIT 1').bind(libId).first();
      if (!used) await env.DB.prepare('UPDATE library_files SET orphaned_at = ? WHERE id = ? AND orphaned_at IS NULL').bind(Date.now(), libId).run();
    }
  }
  return doomed.length;
}

/**
 * Delete library files that have been unattached for more than 30 days (never
 * attached, manually detached, or whose last task was removed). Removes the R2
 * object and the row.
 */
async function deleteOrphanedLibraryFiles(env: Env): Promise<number> {
  const cutoff = Date.now() - COMPLETED_RETENTION_MS;
  const { results } = await env.DB
    .prepare('SELECT id, r2_key FROM library_files WHERE orphaned_at IS NOT NULL AND orphaned_at < ?')
    .bind(cutoff)
    .all<{ id: string; r2_key: string }>();
  for (const f of results) {
    try { await env.ATTACHMENTS.delete(f.r2_key); } catch (e) { console.error('library R2 delete failed', f.r2_key, e); }
    await env.DB.prepare('DELETE FROM library_files WHERE id = ?').bind(f.id).run();
  }
  return results.length;
}

const DUE_SOON_MS = 3 * 24 * 60 * 60 * 1000; // "due soon" = within 3 days (or overdue)

function fmtDate(ms: number): string {
  // Due dates are stored as UTC midnight — format in UTC to keep the day stable.
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function dueLabel(ms: number, now: number): string {
  const d = fmtDate(ms);
  if (ms < now) return `${d} (overdue)`;
  return d;
}

/**
 * Build and send each user's morning digest. Sends only to users who have at
 * least one item across: awaiting their sign-off, assigned to them, or due soon.
 * No-ops entirely if RESEND_API_KEY isn't configured on the worker.
 */
async function sendDailyDigests(env: Env): Promise<number> {
  if (!env.RESEND_API_KEY) { console.log('digest: RESEND_API_KEY not set, skipping'); return 0; }
  const appUrl = `https://${env.APP_DOMAIN ?? 'tasks.esprey.net'}`;
  const now = Date.now();
  const dueCutoff = now + DUE_SOON_MS;

  const { results: users } = await env.DB
    .prepare('SELECT email, name FROM users')
    .all<{ email: string; name: string }>();

  let sent = 0;
  for (const u of users) {
    const email = u.email.toLowerCase();

    const { results: awaiting } = await env.DB.prepare(
      `SELECT t.title AS task_title, s.text AS subtask_text
       FROM subtasks s JOIN tasks t ON t.id = s.task_id
       WHERE t.owner_email = ? AND s.status = 'done' AND s.accepted_at IS NULL
       ORDER BY t.title`,
    ).bind(email).all<{ task_title: string; subtask_text: string }>();

    const { results: assigned } = await env.DB.prepare(
      `SELECT t.title AS task_title, s.text AS subtask_text, s.status AS status, s.due_date AS due_date
       FROM subtask_assignees sa JOIN subtasks s ON s.id = sa.subtask_id JOIN tasks t ON t.id = s.task_id
       WHERE sa.user_email = ? AND s.accepted_at IS NULL
       ORDER BY (s.due_date IS NULL), s.due_date`,
    ).bind(email).all<{ task_title: string; subtask_text: string; status: string; due_date: number | null }>();

    const { results: dueTasks } = await env.DB.prepare(
      `SELECT title, due_date FROM tasks
       WHERE owner_email = ? AND status != 'done' AND completed_at IS NULL
         AND due_date IS NOT NULL AND due_date <= ?
       ORDER BY due_date`,
    ).bind(email, dueCutoff).all<{ title: string; due_date: number }>();

    if (!awaiting.length && !assigned.length && !dueTasks.length) continue;

    const firstName = (u.name || '').trim().split(/\s+/)[0] || 'there';
    const textParts: string[] = [`Hi ${firstName},`, '', "Here's your Esprey Tasks summary for today."];
    const htmlParts: string[] = [`<p>Hi ${firstName},</p><p>Here's your Esprey Tasks summary for today.</p>`];

    if (awaiting.length) {
      textParts.push('', `AWAITING YOUR SIGN-OFF (${awaiting.length})`);
      awaiting.forEach((a) => textParts.push(`- ${a.subtask_text} — ${a.task_title}`));
      htmlParts.push(`<p><strong>Awaiting your sign-off (${awaiting.length})</strong></p><ul>${awaiting.map((a) => `<li>${esc(a.subtask_text)} — <em>${esc(a.task_title)}</em></li>`).join('')}</ul>`);
    }
    if (assigned.length) {
      textParts.push('', `ASSIGNED TO YOU (${assigned.length})`);
      assigned.forEach((a) => textParts.push(`- ${a.subtask_text} — ${a.task_title}${a.due_date ? ` (due ${dueLabel(a.due_date, now)})` : ''}`));
      htmlParts.push(`<p><strong>Assigned to you (${assigned.length})</strong></p><ul>${assigned.map((a) => `<li>${esc(a.subtask_text)} — <em>${esc(a.task_title)}</em>${a.due_date ? ` <span style="color:#5b21b6">(due ${dueLabel(a.due_date, now)})</span>` : ''}</li>`).join('')}</ul>`);
    }
    if (dueTasks.length) {
      textParts.push('', `YOUR PROJECTS DUE SOON (${dueTasks.length})`);
      dueTasks.forEach((d) => textParts.push(`- ${d.title} — due ${dueLabel(d.due_date, now)}`));
      htmlParts.push(`<p><strong>Your projects due soon (${dueTasks.length})</strong></p><ul>${dueTasks.map((d) => `<li>${esc(d.title)} — <span style="color:#5b21b6">due ${dueLabel(d.due_date, now)}</span></li>`).join('')}</ul>`);
    }

    textParts.push('', `Open the app: ${appUrl}`);
    htmlParts.push(`<p><a href="${appUrl}">Open Esprey Tasks</a></p>`);

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Esprey Tasks <tasks@esprey.net>',
          to: [u.email],
          reply_to: env.ADMIN_EMAIL,
          subject: 'Your Esprey Tasks summary',
          text: textParts.join('\n'),
          html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1c1917;line-height:1.55;">${htmlParts.join('')}</div>`,
        }),
      });
      sent++;
    } catch (e) {
      console.error('digest send failed for', u.email, e);
    }
  }
  return sent;
}

/** Minimal HTML escaping for user-supplied text in the digest. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Advance a UTC-midnight date by N units. Uses Date.UTC so month overflow
 * normalises (e.g. 31 Jan + 1 month → early Mar) and timezones never shift the
 * calendar day.
 */
function addInterval(ms: number, unit: string, n: number): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const da = d.getUTCDate();
  if (unit === 'week') return Date.UTC(y, mo, da + 7 * n);
  if (unit === 'month') return Date.UTC(y, mo + n, da);
  return Date.UTC(y, mo, da + n); // 'day' (and fallback)
}

interface RecurTaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: string | null;
  owner_email: string | null;
  company_id: string | null;
  company_name: string | null;
  recur_interval: number | null;
  recur_unit: string | null;
  recur_next_at: number | null;
}
interface SubtaskRow {
  id: string;
  text: string;
  position: number | null;
  instructions: string | null;
  due_date: number | null;
}

/**
 * Schedule-based recurring tasks (baton model). For every task whose
 * recur_next_at has arrived, spawn a fresh full copy (subtasks + assignees +
 * contacts, reset to "to do" with member notes cleared) dated at the occurrence,
 * carry the recurrence onto the new copy advanced by one interval, and clear the
 * recurrence on the old task so it behaves as a normal one-off from then on.
 */
async function generateRecurring(env: Env): Promise<number> {
  const now = Date.now();
  const { results: due } = await env.DB
    .prepare("SELECT * FROM tasks WHERE recur_unit IS NOT NULL AND recur_active = 1 AND recur_next_at IS NOT NULL AND recur_next_at <= ?")
    .bind(now)
    .all<RecurTaskRow>();
  if (!due.length) return 0;

  let made = 0;
  for (const t of due) {
    const unit = t.recur_unit as string;
    const n = t.recur_interval && t.recur_interval > 0 ? t.recur_interval : 1;
    const occ = t.recur_next_at as number; // this copy's occurrence date
    const next = addInterval(occ, unit, n); // when the NEXT copy is due
    const newId = nanoid();

    await env.DB.prepare(
      `INSERT INTO tasks (
        id, title, description, status, priority, source, owner_email,
        company_id, company_name, created_at, updated_at, due_date,
        recur_interval, recur_unit, recur_next_at, recur_active
      ) VALUES (?, ?, ?, 'todo', ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
      .bind(
        newId, t.title, t.description ?? '', t.priority ?? 'normal', t.owner_email,
        t.company_id ?? null, t.company_name ?? null, now, now, occ,
        n, unit, next,
      )
      .run();

    try {
      await env.DB.prepare(
        'INSERT INTO task_events (id, task_id, actor_email, type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(nanoid(), newId, null, 'created', 'Created automatically (repeating project)', now).run();
    } catch (e) { console.error('failed to log recurrence create event:', e); }

    // Clone subtasks (fresh state) + their assignees and contacts.
    const { results: subs } = await env.DB
      .prepare('SELECT id, text, position, instructions, due_date FROM subtasks WHERE task_id = ? ORDER BY position ASC, created_at ASC')
      .bind(t.id)
      .all<SubtaskRow>();
    for (const s of subs) {
      const nsid = nanoid();
      const sdue = s.due_date ? addInterval(s.due_date, unit, n) : null;
      await env.DB.prepare(
        `INSERT INTO subtasks (id, task_id, text, done, status, position, created_at, notes, instructions, completion_note, accepted_at, due_date)
         VALUES (?, ?, ?, 0, 'todo', ?, ?, '', ?, '', NULL, ?)`,
      ).bind(nsid, newId, s.text, s.position ?? 0, now, s.instructions ?? '', sdue).run();

      const { results: asg } = await env.DB
        .prepare('SELECT user_email FROM subtask_assignees WHERE subtask_id = ?')
        .bind(s.id)
        .all<{ user_email: string }>();
      if (asg.length) {
        await env.DB.batch(asg.map((a) =>
          env.DB.prepare('INSERT OR IGNORE INTO subtask_assignees (subtask_id, user_email) VALUES (?, ?)').bind(nsid, a.user_email),
        ));
      }
      const { results: cons } = await env.DB
        .prepare('SELECT contact_id FROM subtask_contacts WHERE subtask_id = ?')
        .bind(s.id)
        .all<{ contact_id: string }>();
      if (cons.length) {
        await env.DB.batch(cons.map((c) =>
          env.DB.prepare('INSERT OR IGNORE INTO subtask_contacts (subtask_id, contact_id) VALUES (?, ?)').bind(nsid, c.contact_id),
        ));
      }
    }

    // Pass the baton: the old task stops repeating (the new copy carries it on).
    await env.DB
      .prepare('UPDATE tasks SET recur_unit = NULL, recur_interval = NULL, recur_next_at = NULL, updated_at = ? WHERE id = ?')
      .bind(now, t.id)
      .run();
    made++;
  }
  return made;
}

export default {
  // Cron handlers (see wrangler.toml [triggers]).
  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 6 * * *') {
      const n = await sendDailyDigests(env);
      console.log(`Daily digest: sent ${n} email(s)`);
    } else {
      // Generate due recurrences first, then prune (a freshly-spawned copy is
      // never old enough to be purged, so order is for clarity only).
      const g = await generateRecurring(env);
      console.log(`Recurring tasks: generated ${g} new occurrence(s)`);
      const n = await purgeOldCompleted(env);
      console.log(`Scheduled cleanup: removed ${n} completed task(s) older than 1 month`);
      const lib = await deleteOrphanedLibraryFiles(env);
      console.log(`Library cleanup: removed ${lib} unattached file(s) older than 1 month`);
    }
  },

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(rawEmail);

    const subject = parsed.subject ?? message.headers.get('subject') ?? '(no subject)';
    let fromEmail = parsed.from?.address ?? message.from;
    let fromName = parsed.from?.name ?? fromEmail;

    // Outer email body (prefer plain text, else strip HTML).
    const outerBody =
      parsed.text ??
      (parsed.html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // Collect attachments we care about.
    const candidates = (parsed.attachments ?? []).filter((att) =>
      isWantedAttachment(att as { mimeType?: string; filename?: string; disposition?: string; contentId?: string }),
    );

    const aiAttachments: AiAttachment[] = [];
    const toStore: { id: string; bytes: Uint8Array; mime: string; filename: string; ext: string }[] = [];
    let emlText = '';
    let originalSender: { address?: string; name?: string } | null = null;

    for (const att of candidates) {
      const rawMime = (att.mimeType ?? 'application/octet-stream').toLowerCase();
      const isEml = rawMime === 'message/rfc822' || (att.filename ?? '').toLowerCase().endsWith('.eml');
      const mime = isEml ? 'message/rfc822' : rawMime;
      const bytes = toUint8(att.content as ArrayBuffer | Uint8Array | string);
      const ext = extFromMime(mime);
      const id = nanoid();

      toStore.push({ id, bytes, mime, filename: att.filename ?? `attachment.${ext}`, ext });

      if (isEml) {
        // Parse the attached email so the task reflects the ORIGINAL message/sender.
        try {
          const inner = await PostalMime.parse(bytes);
          if (!originalSender && inner.from?.address) {
            originalSender = { address: inner.from.address, name: inner.from.name };
          }
          const innerBody =
            inner.text ?? (inner.html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const header = inner.from?.address
            ? ` from ${inner.from.name ?? ''} <${inner.from.address}>`
            : '';
          const subj = inner.subject ? `, subject: ${inner.subject}` : '';
          if (innerBody) emlText += `\n\n--- Attached email${header}${subj} ---\n${innerBody.slice(0, 3000)}`;
        } catch (e) {
          console.error('failed to parse .eml attachment:', e);
        }
      } else if (mime === 'application/pdf' || AI_IMAGE_TYPES.includes(mime)) {
        aiAttachments.push({ mime, base64: uint8ToBase64(bytes) });
      }
      // Other types (e.g. HEIC) are stored but not sent to the model.
    }

    // If an email was attached, prefer the original sender for the task.
    if (originalSender?.address) {
      fromEmail = originalSender.address;
      fromName = originalSender.name ?? originalSender.address;
    }

    const combinedBody = (outerBody + emlText).trim();

    // Extract the task with Claude (fall back to subject/body on failure).
    let task: ParsedTask;
    try {
      task = await extractTask(env.ANTHROPIC_API_KEY, {
        subject,
        body: combinedBody,
        attachments: aiAttachments,
      });
    } catch (err) {
      task = {
        title: subject.slice(0, 100),
        description: combinedBody.slice(0, 500),
        priority: 'normal',
        subtasks: [],
      };
      console.error('Claude extraction failed, using fallback:', err);
    }

    const now = Date.now();
    const id = nanoid();
    // The task belongs to the employee who forwarded it (envelope sender).
    const ownerEmail = await resolveOwner(env.DB, message.from, env.ADMIN_EMAIL);

    await env.DB.prepare(
      `INSERT INTO tasks (
        id, title, description, status, priority, source, owner_email,
        from_email, from_name, original_subject, original_body,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'todo', ?, 'email', ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        task.title,
        task.description,
        task.priority,
        ownerEmail,
        fromEmail,
        fromName,
        subject,
        combinedBody.slice(0, 10000),
        now,
        now,
      )
      .run();

    // Activity timeline: record that this task came in from an email.
    try {
      await env.DB.prepare(
        'INSERT INTO task_events (id, task_id, actor_email, type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(nanoid(), id, ownerEmail, 'created', `Created from email: ${subject.slice(0, 120)}`, now).run();
    } catch (e) {
      console.error('failed to log create event:', e);
    }

    // Insert any subtasks Claude extracted.
    if (task.subtasks.length > 0) {
      try {
        await env.DB.batch(
          task.subtasks.map((text, i) =>
            env.DB.prepare(
              `INSERT INTO subtasks (id, task_id, text, done, position, created_at)
               VALUES (?, ?, ?, 0, ?, ?)`,
            ).bind(nanoid(), id, text.slice(0, 300), i, now),
          ),
        );
      } catch (e) {
        console.error('failed to insert subtasks:', e);
      }
    }

    // Persist the original attachments to R2 + record them, isolated per-file.
    let storedCount = 0;
    for (const s of toStore) {
      try {
        const key = r2KeyForAttachment(s.id, s.ext);
        await env.ATTACHMENTS.put(key, s.bytes, {
          httpMetadata: { contentType: s.mime },
          customMetadata: { taskId: id, filename: s.filename },
        });
        await env.DB.prepare(
          `INSERT INTO task_attachments (id, task_id, r2_key, filename, mime_type, size, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(s.id, id, key, s.filename, s.mime, s.bytes.length, now)
          .run();
        storedCount++;
      } catch (e) {
        console.error('failed to store attachment', s.filename, e);
      }
    }

    console.log(
      `Task created from email: id=${id} title="${task.title}" from=${fromEmail} attachments=${storedCount}`,
    );
  },
} satisfies ExportedHandler<Env>;
