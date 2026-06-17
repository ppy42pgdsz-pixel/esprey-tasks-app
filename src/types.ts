export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskSource = 'manual' | 'email';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  source: TaskSource;
  from_email: string | null;
  from_name: string | null;
  original_subject: string | null;
  original_body: string | null;
  draft_reply: string | null;
  company_id: string | null;
  company_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  created_at: number;
  updated_at: number;
  due_date: number | null;
}

export interface Company {
  id: string;
  name: string;
  created_at: number;
}

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  company_id: string | null;
  is_favourite: number; // 1 = true, 0 = false
  created_at: number;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  filename: string | null;
  mime_type: string | null;
  size: number | null;
  created_at: number;
}
