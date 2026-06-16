/**
 * GET  /api/tasks        — list all tasks (sorted newest first)
 * POST /api/tasks        — create a task manually
 */

import { nanoid } from 'nanoid';

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const status = url.searchParams.get('status'); // optional filter

  let query = 'SELECT * FROM tasks';
  const params: string[] = [];

  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC';

  const { results } = await ctx.env.DB.prepare(query).bind(...params).all();
  return json(results);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const body = await ctx.request.json<{
    title: string;
    description?: string;
    priority?: string;
    due_date?: number;
  }>();

  if (!body.title?.trim()) {
    return json({ error: 'title is required' }, 400);
  }

  const now = Date.now();
  const id = nanoid();

  await ctx.env.DB.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, source, created_at, updated_at, due_date)
     VALUES (?, ?, ?, 'todo', ?, 'manual', ?, ?, ?)`
  )
    .bind(
      id,
      body.title.trim(),
      body.description ?? '',
      body.priority ?? 'normal',
      now,
      now,
      body.due_date ?? null
    )
    .run();

  const task = await ctx.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  return json(task, 201);
};
