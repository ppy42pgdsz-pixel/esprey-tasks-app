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
  // Ownership & sharing.
  owner_email?: string | null;
  owner_name?: string | null;
  visibility?: 'private' | 'shared';
  // Present on the list endpoint (subtask progress); optional elsewhere.
  subtask_total?: number;
  subtask_done?: number;
  pending_signoff?: number; // subtasks marked done but awaiting owner sign-off
  completed_at?: number | null;
  archived?: number; // 1 = completed for the current viewer (owner done, or all my subtasks accepted)
  assignee_names?: string | null; // comma-joined member names assigned across subtasks
  assigned_contact_names?: string | null; // comma-joined contact names assigned across subtasks
  min_subtask_due?: number | null; // earliest due date among open subtasks
}

export type UserRole = 'admin' | 'member';

export interface User {
  email: string;
  name: string;
  role: UserRole;
  created_at: number;
  aliases?: string[];
  company_ids?: string[];
}

export interface Subtask {
  id: string;
  task_id: string;
  text: string;
  done: number; // 1 = done (legacy mirror of status === 'done')
  status: TaskStatus; // todo | in_progress | done
  position: number;
  created_at: number;
  notes?: string;
  assignee_emails?: string[];
  contact_ids?: string[];
  accepted_at?: number | null; // set when the owner signs off; null = awaiting sign-off
  due_date?: number | null;
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
  subtask_id?: string | null;
  filename: string | null;
  mime_type: string | null;
  size: number | null;
  summary?: string | null;
  created_at: number;
}
