/**
 * Claude email planner. Reads the forwarded email (the forwarder's note, the
 * quoted message, and any image/PDF attachments) and returns a MULTI-ACTION
 * plan: which project to create or add to, what tasks to extract, and where the
 * attachments should go (library and/or the project), plus whether to file the
 * email itself as a PDF. The worker validates and executes the plan.
 */

const MODEL = 'claude-sonnet-4-6';

// Image media types Anthropic vision accepts. Others (e.g. HEIC) are stored
// but not sent to the model.
const AI_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export interface EmailPlan {
  /** Target project. name=null means "no project" (pure library filing). */
  project: { name: string | null; match_existing: boolean };
  priority: 'low' | 'normal' | 'high';
  /** Description used only when a NEW project is created. */
  description: string;
  /** Task items (subtasks) to add to the project. */
  tasks: string[];
  attachments: { to_library: boolean; to_project: boolean };
  /** Render the email body itself to a PDF and file it in the library. */
  file_email_as_pdf: boolean;
}

export interface AiAttachment {
  mime: string;
  base64: string;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

export async function planEmail(
  apiKey: string,
  input: { subject: string; body: string; instruction?: string; attachments?: AiAttachment[]; hasFiles?: boolean },
): Promise<EmailPlan> {
  const hasAttachments = (input.attachments ?? []).some(
    (a) => a.mime.toLowerCase() === 'application/pdf' || AI_IMAGE_TYPES.includes(a.mime.toLowerCase()),
  );
  const hasFiles = input.hasFiles ?? hasAttachments;

  const prompt = `You are processing a forwarded email for a personal task & document system.
The system has PROJECTS (each holds a list of TASKS) and a LIBRARY (a private file store).
A forwarded email may have FILE ATTACHMENTS (the real attached files).

Read the forwarder's instruction (the note they wrote at the top) and decide a PLAN that may do SEVERAL things at once.

Forwarder's instruction (their note — the primary signal for what to do):
${(input.instruction ?? input.body).slice(0, 2000)}

Email subject: ${input.subject}
Email body:
${input.body.slice(0, 6000)}
This email ${hasFiles ? 'HAS' : 'has NO'} file attachment(s).${hasAttachments ? ' The attached files (images/PDFs) are included below — read them.' : ''}

Decide each field:

PROJECT
- "project": where extracted tasks and/or project-bound attachments go.
  - "name": the project name. If the instruction names a project ("a project called Life Insurance", "add to my Tax project"), use that exact name. If the forwarder just wants tasks made with no named project, invent a short descriptive project title. Use null ONLY when the email is purely "save/file this to my library" with no tasks and nothing to attach to a project.
  - "match_existing": true if the forwarder referred to a project by name (so we should add to an existing one if it exists). false if you invented the title for a plain forward.

TASKS
- "tasks": the action items to add to the project, each a short imperative string (max ~14 words). If the email lists requested documents, requirements, or multiple follow-ups, make EACH one a task. If there is nothing actionable (pure filing), return [].

ATTACHMENTS (only meaningful if the email has files)
- "attachments.to_library": true if the forwarder wants the attached file(s) saved/filed/kept in their library.
- "attachments.to_project": true if the attached file(s) should be attached to the project. For a normal task email with files, default this to true so the files stay with the project. Both can be true ("add to my library AND to the project").

EMAIL-AS-PDF
- "file_email_as_pdf": true ONLY if the forwarder wants the EMAIL ITSELF saved/archived as a record (e.g. "save this email", "file this for my records", "keep this"). false otherwise (e.g. they only mentioned saving an attachment, or it's a normal task email).

PRIORITY: high (urgent/time-sensitive), normal (standard), low (FYI).
DESCRIPTION: one line summarising the project, used only if a new project is created (max 300 chars).

Return ONLY a single JSON object, nothing before or after it:
{
  "project": { "name": "string or null", "match_existing": true },
  "priority": "low|normal|high",
  "description": "short summary",
  "tasks": ["task one", "task two"],
  "attachments": { "to_library": false, "to_project": true },
  "file_email_as_pdf": false
}

Rules:
- Output ONLY the JSON object — no markdown, no code fences, no commentary.
- Keep every value on a single line. Do NOT put line breaks inside any string.
- Use straight quotes and escape any quotes inside a value.`;

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
      max_tokens: 1500,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const result = await response.json<{ content: Array<{ type: string; text: string }> }>();
  const text = result.content.find((c) => c.type === 'text')?.text ?? '{}';
  return parseEmailPlan(text, hasFiles);
}

/**
 * Tolerant parser for Claude's JSON reply. Strips markdown fences and any prose
 * around the object, isolates the outermost {...}, then validates the fields,
 * filling sensible defaults so the worker always gets a usable plan.
 */
export function parseEmailPlan(text: string, hasFiles: boolean): EmailPlan {
  let cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);

  const obj = JSON.parse(cleaned) as any;

  const priority: EmailPlan['priority'] =
    obj.priority === 'low' || obj.priority === 'high' ? obj.priority : 'normal';

  const rawName = obj?.project?.name;
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 100) : null;

  const tasks = Array.isArray(obj.tasks)
    ? obj.tasks.map((s: unknown) => String(s).trim()).filter((s: string) => s.length > 0).slice(0, 40)
    : [];

  // Default attachment routing: if files are present and Claude said nothing
  // useful, keep them with the project (today's behaviour).
  const aObj = obj.attachments ?? {};
  let toLibrary = !!aObj.to_library;
  let toProject = !!aObj.to_project;
  if (hasFiles && !toLibrary && !toProject) toProject = true;

  return {
    project: { name, match_existing: !!obj?.project?.match_existing },
    priority,
    description: String(obj.description ?? '').trim().slice(0, 500),
    tasks,
    attachments: { to_library: toLibrary, to_project: toProject },
    file_email_as_pdf: !!obj.file_email_as_pdf,
  };
}
