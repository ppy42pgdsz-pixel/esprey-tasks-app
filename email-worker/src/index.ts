/**
 * Cloudflare Email Worker — esprey-tasks-email
 *
 * Triggered when an email arrives at tasks@esprey.net.
 * 1. Parses the raw MIME message with postal-mime
 * 2. Sends the email to Claude to extract a structured task
 * 3. Inserts the task into the D1 database
 *
 * Auto-deploy: connected to GitHub via Cloudflare Workers Builds (root: email-worker).
 */

import PostalMime from 'postal-mime';

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  ADMIN_EMAIL: string;
  ADMIN_NAME: string;
}

interface ParsedTask {
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high';
}

async function extractTask(
  subject: string,
  body: string,
  apiKey: string
): Promise<ParsedTask> {
  const prompt = `You are parsing a forwarded email into a structured task for a personal task management system.

Email subject: ${subject}
Email body:
${body.slice(0, 3000)}

Extract a task from this email. Return ONLY a single JSON object, nothing before or after it, with these fields:
{
  "title": "Short, action-oriented task title (max 100 chars)",
  "description": "Brief summary of what needs to be done or followed up on (max 300 chars)",
  "priority": "low|normal|high"
}

Formatting rules (important):
- Output ONLY the JSON object — no markdown, no code fences, no commentary.
- Keep every value on a single line. Do NOT put line breaks inside any string.
- Keep the description under 300 characters so the JSON is never truncated.
- Use straight quotes and escape any quotes that appear inside a value.

Priority guide:
- high: urgent, time-sensitive, or explicitly marked as important
- normal: standard follow-up or action required
- low: FYI, informational, or no clear deadline`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const result = await response.json<{ content: Array<{ type: string; text: string }> }>();
  const text = result.content.find((c) => c.type === 'text')?.text ?? '{}';
  return parseTaskJson(text);
}

/**
 * Tolerant parser for Claude's JSON reply. Strips markdown fences and any prose
 * around the object, extracts the outermost {...}, then validates/normalises the
 * fields. Throws if no usable JSON is found, so the caller can fall back.
 */
function parseTaskJson(text: string): ParsedTask {
  let cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // Isolate the outermost JSON object in case the model added stray text.
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }

  const obj = JSON.parse(cleaned) as Partial<ParsedTask>;

  const priority: ParsedTask['priority'] =
    obj.priority === 'low' || obj.priority === 'high' ? obj.priority : 'normal';

  return {
    title: String(obj.title ?? '').trim().slice(0, 100),
    description: String(obj.description ?? '').trim().slice(0, 500),
    priority,
  };
}

function nanoid(): string {
  // Simple ID generator for the Worker environment (no npm nanoid needed)
  return crypto.randomUUID().replace(/-/g, '').slice(0, 21);
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    // Parse the raw email
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(rawEmail);

    const subject = parsed.subject ?? message.headers.get('subject') ?? '(no subject)';
    const fromEmail = parsed.from?.address ?? message.from;
    const fromName = parsed.from?.name ?? fromEmail;

    // Use text body, fall back to stripping HTML tags
    const body =
      parsed.text ??
      (parsed.html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // Extract structured task using Claude
    let task: ParsedTask;
    try {
      task = await extractTask(subject, body, env.ANTHROPIC_API_KEY);
    } catch (err) {
      // Fallback: use subject as title
      task = {
        title: subject.slice(0, 100),
        description: body.slice(0, 500),
        priority: 'normal',
      };
      console.error('Claude extraction failed, using fallback:', err);
    }

    const now = Date.now();
    const id = nanoid();

    await env.DB.prepare(
      `INSERT INTO tasks (
        id, title, description, status, priority, source,
        from_email, from_name, original_subject, original_body,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'todo', ?, 'email', ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        task.title,
        task.description,
        task.priority,
        fromEmail,
        fromName,
        subject,
        body.slice(0, 10000), // cap stored body at 10k chars
        now,
        now
      )
      .run();

    console.log(`Task created from email: id=${id} title="${task.title}" from=${fromEmail}`);
  },
} satisfies ExportedHandler<Env>;
