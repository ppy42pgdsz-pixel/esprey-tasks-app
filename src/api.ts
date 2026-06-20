import type { Task, TaskStatus, TaskPriority, Company, Contact, TaskAttachment, Subtask, User, UserRole } from './types';

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
  listTasks: (status?: TaskStatus, company_id?: string, contact_id?: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (company_id) params.set('company_id', company_id);
    if (contact_id) params.set('contact_id', contact_id);
    const qs = params.toString();
    return request<Task[]>(`/api/tasks${qs ? `?${qs}` : ''}`);
  },

  getTask: (id: string) => request<Task>(`/api/tasks/${id}`),

  createTask: (data: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    due_date?: number;
    company_id?: string;
    company_name?: string;
    contact_id?: string;
    contact_name?: string;
    visibility?: 'private' | 'shared';
    share_emails?: string[];
  }) =>
    request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(data) }),

  updateTask: (id: string, data: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'due_date' | 'draft_reply' | 'company_id' | 'company_name' | 'contact_id' | 'contact_name'>>) =>
    request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteTask: (id: string) =>
    request<{ ok: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' }),

  generateDraftReply: (id: string) =>
    request<{ draft_reply: string }>(`/api/tasks/${id}/draft-reply`, { method: 'POST' }),

  listAttachments: (taskId: string) =>
    request<TaskAttachment[]>(`/api/tasks/${taskId}/attachments`),

  listCompanies: () => request<Company[]>('/api/companies'),
  createCompany: (name: string) =>
    request<Company>('/api/companies', { method: 'POST', body: JSON.stringify({ name }) }),
  updateCompany: (id: string, name: string) =>
    request<Company>(`/api/companies/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteCompany: (id: string) =>
    request<{ ok: boolean }>(`/api/companies/${id}`, { method: 'DELETE' }),

  listContacts: () => request<Contact[]>('/api/contacts'),
  createContact: (data: { name: string; email?: string; company_id?: string; is_favourite?: boolean }) =>
    request<Contact>('/api/contacts', { method: 'POST', body: JSON.stringify(data) }),
  updateContact: (id: string, data: { name?: string; email?: string | null; company_id?: string | null; is_favourite?: boolean }) =>
    request<Contact>(`/api/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteContact: (id: string) =>
    request<{ ok: boolean }>(`/api/contacts/${id}`, { method: 'DELETE' }),

  getShare: (taskId: string) =>
    request<{ owner_email: string | null; visibility: 'private' | 'shared'; user_emails: string[] }>(`/api/tasks/${taskId}/share`),
  setShare: (taskId: string, data: { visibility: 'private' | 'shared'; user_emails: string[] }) =>
    request<{ ok: boolean; visibility: 'private' | 'shared'; user_emails: string[] }>(`/api/tasks/${taskId}/share`, { method: 'PUT', body: JSON.stringify(data) }),

  listSubtasks: (taskId: string) =>
    request<Subtask[]>(`/api/tasks/${taskId}/subtasks`),
  createSubtask: (taskId: string, text: string) =>
    request<Subtask>(`/api/tasks/${taskId}/subtasks`, { method: 'POST', body: JSON.stringify({ text }) }),
  updateSubtask: (id: string, data: { text?: string; done?: boolean; status?: TaskStatus; notes?: string; accepted?: boolean; due_date?: number | null }) =>
    request<Subtask>(`/api/subtasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSubtask: (id: string) =>
    request<{ ok: boolean }>(`/api/subtasks/${id}`, { method: 'DELETE' }),
  setSubtaskAssignees: (id: string, data: { user_emails: string[]; contact_ids: string[] }) =>
    request<{ ok: boolean; user_emails: string[]; contact_ids: string[] }>(`/api/subtasks/${id}/assignees`, { method: 'PUT', body: JSON.stringify(data) }),

  // ─── Team / identity ───
  getMe: () => request<{ email: string; name: string; role: UserRole }>('/api/me'),
  listUsers: () => request<User[]>('/api/users'),
  createUser: (data: { name: string; email: string; role?: UserRole }) =>
    request<User>('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (email: string, data: { name?: string; role?: UserRole }) =>
    request<User>(`/api/users/${encodeURIComponent(email)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteUser: (email: string, wipe = false) =>
    request<{ ok: boolean }>(`/api/users/${encodeURIComponent(email)}${wipe ? '?wipe=true' : ''}`, { method: 'DELETE' }),
  addUserAlias: (email: string, alias: string) =>
    request<{ ok: boolean; alias: string }>(`/api/users/${encodeURIComponent(email)}/aliases`, { method: 'POST', body: JSON.stringify({ alias }) }),
  removeUserAlias: (email: string, alias: string) =>
    request<{ ok: boolean }>(`/api/users/${encodeURIComponent(email)}/aliases?alias=${encodeURIComponent(alias)}`, { method: 'DELETE' }),
  setUserCompanies: (email: string, company_ids: string[]) =>
    request<{ ok: boolean; company_ids: string[] }>(`/api/users/${encodeURIComponent(email)}/companies`, { method: 'PUT', body: JSON.stringify({ company_ids }) }),

  sendDigest: (all: boolean) =>
    request<{ sent: number; skipped: string[]; recipients: number }>(`/api/admin/send-digest?confirm=yes${all ? '&all=yes' : ''}`),
};
