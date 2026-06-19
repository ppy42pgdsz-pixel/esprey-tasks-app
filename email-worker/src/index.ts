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
  const { results: doomed } = await env.DB
    .prepare('SELECT id FROM tasks WHERE completed_at IS NOT NULL AND completed_at < ?')
    .bind(cutoff)
    .all<{ id: string }>();
  if (!doomed.length) return 0;

  for (const { id } of doomed) {
    // Purge R2 objects for this task's attachments first.
    const { results: atts } = await env.DB
      .prepare('SELECT r2_key FROM task_attachments WHERE task_id = ?')
      .bind(id)
      .all<{ r2_key: string }>();
    for (const a of atts) {
      try { await env.ATTACHMENTS.delete(a.r2_key); } catch (e) { console.error('R2 delete failed', a.r2_key, e); }
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM subtask_assignees WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)').bind(id),
      env.DB.prepare('DELETE FROM subtask_contacts WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)').bind(id),
      env.DB.prepare('DELETE FROM subtasks WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM task_shares WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM task_attachments WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id),
    ]);
  }
  return doomed.length;
}

export default {
  // Daily cron (see wrangler.toml [triggers]) — prune old completed tasks.
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const n = await purgeOldCompleted(env);
    console.log(`Scheduled cleanup: removed ${n} completed task(s) older than 1 month`);
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
