import type { Task, TaskStatus, TaskPriority } from './types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json<{ error: string }>().catch(() => ({ error: res.statusText }));
    throw new Error(err.error);
  }
  return res.json<T>();
}

export const api = {
  listTasks: (status?: TaskStatus) =>
    request<Task[]>(`/api/tasks${status ? `?status=${status}` : ''}`),

  getTask: (id: string) => request<Task>(`/api/tasks/${id}`),

  createTask: (data: { title: string; description?: string; priority?: TaskPriority; due_date?: number }) =>
    request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(data) }),

  updateTask: (id: string, data: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'due_date' | 'draft_reply'>>) =>
    request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteTask: (id: string) =>
    request<{ ok: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' }),

  generateDraftReply: (id: string) =>
    request<{ draft_reply: string }>(`/api/tasks/${id}/draft-reply`, { method: 'POST' }),
};
