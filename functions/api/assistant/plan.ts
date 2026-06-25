/**
 * POST /api/assistant/plan  { message }
 * Sends the user's request + a snapshot of their projects/tasks/team to Claude,
 * which replies with a plain-English plan and a structured list of proposed
 * actions. Nothing is executed here — the client confirms first.
 */
import { meFromCtx, json } from '../_lib';
import { loadContext, type AssistantAction } from './_assistant';

interface Env { DB: D1Database; ANTHROPIC_API_KEY: string }

const ACTION_SPEC = `You can ONLY use these action types (JSON objects):
- {"type":"create_project","title":string,"company_name"?:string,"tasks"?:string[]}
- {"type":"rename_project","project_id":string,"title":string}
- {"type":"add_tasks","project_id":string,"tasks":string[]}
- {"type":"move_tasks","task_ids":string[],"to_project_id":string}
- {"type":"merge_projects","source_project_ids":string[],"target_project_id"?:string,"new_title"?:string}
- {"type":"assign_tasks","task_ids":string[],"assignee_emails":string[]}
- {"type":"set_task_due","task_ids":string[],"due_date":string|null}   (due_date is "YYYY-MM-DD")
- {"type":"set_task_status","task_ids":string[],"status":"todo"|"in_progress"|"done"}
- {"type":"delete_project","project_id":string}`;

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  const body = await ctx.request.json<{ message?: string }>().catch(() => ({} as { message?: string }));
  const message = (body.message ?? '').trim();
  if (!message) return json({ error: 'message is required' }, 400);

  const { projects, team } = await loadContext(ctx.env.DB, me);
  const today = new Date().toISOString().slice(0, 10);

  const system = `You are the assistant inside a task app. Work is organised into PROJECTS, each containing TASKS.
Turn the user's request into a short reply plus a list of ACTIONS to carry it out.

${ACTION_SPEC}

Rules:
- Only use project_id and task_id values that appear in CONTEXT. NEVER invent ids.
- "task" = an item inside a project (a subtask id). "project" = a top-level container.
- Each project has an "owned" field. If owned is false, it belongs to someone else and only its tasks ASSIGNED TO THE USER are listed — you may ONLY use set_task_status on those tasks. Do NOT rename, merge, move, add to, assign, set due dates on, or delete a project where owned is false.
- For merge_projects: set target_project_id to keep one of the existing projects, or new_title to create a fresh one; all tasks are moved and the emptied source projects are deleted automatically.
- assignee_emails must come from the TEAM list.
- Today is ${today}. Resolve relative dates (e.g. "Friday") to YYYY-MM-DD.
- If the request is ambiguous or you can't map it to the actions, return an empty actions array and ask for clarification in "reply".
- "reply" must clearly state, in plain English, exactly what you will do (names, counts) so the user can confirm.
- Output ONLY a JSON object: {"reply": string, "actions": Action[]}. No text outside the JSON.`;

  const userContent = `CONTEXT
Projects: ${JSON.stringify(projects)}
Team: ${JSON.stringify(team)}

REQUEST
${message}`;

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
  } catch {
    return json({ error: 'Could not reach the AI service' }, 502);
  }
  if (!response.ok) return json({ error: 'AI service error' }, 502);

  const result = await response.json<{ content: Array<{ type: string; text: string }> }>();
  const raw = result.content.find((c) => c.type === 'text')?.text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  let parsed: { reply?: string; actions?: AssistantAction[] } = {};
  try { parsed = match ? JSON.parse(match[0]) : {}; } catch { parsed = {}; }

  const reply = (parsed.reply ?? '').toString() || "Sorry, I couldn't work that out — try rephrasing.";
  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  return json({ reply, actions });
};
