/**
 * Cloudflare Email Worker — esprey-tasks-email
 *
 * Triggered when an email arrives at tasks@esprey.net.
 * 1. Parses the raw MIME message with postal-mime
 * 2. Sends the email to Claude to extract a structured task
 * 3. Inserts the task into the D1 database
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

Extract a task from this email. Return ONLY valid JSON with these fields:
{
  "title": "Short, action-oriented task title (max 100 chars)",
  "description": "Brief summary of what needs to be done or followed up on (max 500 chars)",
  "priority": "low|normal|high"
}

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
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const result = await response.json<{ content: Array<{ type: string; text: string }> }>();
  const text = result.content.find((c) => c.type === 'text')?.text ?? '{}';

  // Strip markdown code fences if Claude wrapped the JSON
  const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned) as ParsedTask;
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
