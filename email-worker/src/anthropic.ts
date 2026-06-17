/**
 * Claude task extraction. Takes the email subject + body and any visual
 * attachments (images / PDFs) and returns a structured task.
 */

const MODEL = 'claude-haiku-4-5-20251001';

// Image media types Anthropic vision accepts. Others (e.g. HEIC) are stored
// but not sent to the model.
const AI_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export interface ParsedTask {
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high';
  subtasks: string[];
}

export interface AiAttachment {
  mime: string;
  base64: string;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

export async function extractTask(
  apiKey: string,
  input: { subject: string; body: string; attachments?: AiAttachment[] },
): Promise<ParsedTask> {
  const hasAttachments = (input.attachments ?? []).some(
    (a) => a.mime.toLowerCase() === 'application/pdf' || AI_IMAGE_TYPES.includes(a.mime.toLowerCase()),
  );

  const prompt = `You are parsing a forwarded email${hasAttachments ? ' and its attachments' : ''} into a structured task for a personal task management system.

Email subject: ${input.subject}
Email body:
${input.body.slice(0, 4000)}
${hasAttachments ? '\nThe attached files (images/PDFs) are part of the same email — read them and factor their contents into the task.' : ''}

Extract a task. Return ONLY a single JSON object, nothing before or after it, with these fields:
{
  "title": "Short, action-oriented task title (max 100 chars)",
  "description": "Brief summary of what needs to be done or followed up on, incorporating anything relevant from the attachments (max 300 chars)",
  "priority": "low|normal|high",
  "subtasks": ["distinct action item", "another action item"]
}

Subtasks rule:
- If the email contains MULTIPLE distinct things to follow up on or do, list each as a short action-oriented string in "subtasks" (max ~12 words each).
- If there is only ONE thing to do, return an empty array: "subtasks": [].
- The title should summarise the overall task; the subtasks are the individual steps.

Formatting rules (important):
- Output ONLY the JSON object — no markdown, no code fences, no commentary.
- Keep every value on a single line. Do NOT put line breaks inside any string.
- Keep the description under 300 characters so the JSON is never truncated.
- Use straight quotes and escape any quotes inside a value.

Priority guide:
- high: urgent, time-sensitive, or explicitly marked as important
- normal: standard follow-up or action required
- low: FYI, informational, or no clear deadline`;

  const content: ContentBlock[] = [{ type: 'text', text: prompt }];
  for (const att of input.attachments ?? []) {
    const mt = att.mime.toLowerCase();
    if (mt === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: att.base64 } });
    } else if (AI_IMAGE_TYPES.includes(mt)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: att.base64 } });
    }
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
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
 * around the object, isolates the outermost {...}, then validates the fields.
 * Throws if no usable JSON is found, so the caller can fall back.
 */
export function parseTaskJson(text: string): ParsedTask {
  let cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }

  const obj = JSON.parse(cleaned) as Partial<ParsedTask>;
  const priority: ParsedTask['priority'] =
    obj.priority === 'low' || obj.priority === 'high' ? obj.priority : 'normal';

  const subtasks = Array.isArray(obj.subtasks)
    ? obj.subtasks.map((s) => String(s).trim()).filter((s) => s.length > 0).slice(0, 20)
    : [];

  return {
    title: String(obj.title ?? '').trim().slice(0, 100),
    description: String(obj.description ?? '').trim().slice(0, 500),
    priority,
    subtasks,
  };
}
