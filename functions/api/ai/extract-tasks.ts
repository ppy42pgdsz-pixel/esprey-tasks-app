/**
 * POST /api/ai/extract-tasks  { text }  ->  { tasks: string[] }
 * Turns pasted free-form text (notes, an email, a rough list) into clean,
 * discrete task titles using Claude. Used by the New Project create screen.
 */

import { meFromCtx } from '../_lib';

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Best-effort: pull a JSON string array out of the model's reply. */
function parseTasks(raw: string): string[] {
  const tidy = (arr: unknown[]): string[] =>
    arr.map((t) => String(t).trim()).filter(Boolean).map((t) => t.slice(0, 300)).slice(0, 50);
  // Prefer a clean JSON array (possibly wrapped in prose or a code fence).
  const match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return tidy(parsed);
    } catch { /* fall through to line splitting */ }
  }
  // Fallback: split lines / numbered or bulleted items.
  return tidy(
    raw
      .split(/\n+/)
      .map((l) => l.replace(/^[\s\-*•·\d.)]+/, '').trim()),
  );
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  await meFromCtx(ctx.env.DB, ctx); // ensure signed in
  const body = await ctx.request.json<{ text?: string }>();
  const text = (body.text ?? '').trim();
  if (!text) return json({ error: 'text is required' }, 400);
  if (text.length > 12000) return json({ error: 'text is too long' }, 400);

  const prompt = `Extract a clean, de-duplicated list of concrete, actionable tasks from the text below.

Rules:
- Each task is a short imperative phrase (e.g. "Email the supplier about pricing").
- Split distinct actions into separate tasks; merge obvious duplicates.
- Ignore greetings, signatures, and filler.
- If the text contains no real tasks, return an empty array.
- Output ONLY a JSON array of strings. No prose, no code fence.

Text:
"""
${text}
"""`;

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ctx.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch {
    return json({ error: 'Could not reach the AI service' }, 502);
  }

  if (!response.ok) return json({ error: 'AI service error' }, 502);

  const result = await response.json<{ content: Array<{ type: string; text: string }> }>();
  const raw = result.content.find((c) => c.type === 'text')?.text ?? '';
  return json({ tasks: parseTasks(raw) });
};
