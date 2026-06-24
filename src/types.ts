export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskSource = 'manual' | 'email';
export type RecurUnit = 'day' | 'week' | 'month';

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
  // Recurrence (schedule-based). recur_unit null = does not repeat.
  recur_interval?: number | null;
  recur_unit?: RecurUnit | null;
  recur_next_at?: number | null; // epoch ms (UTC midnight): next copy generated
  recur_active?: number | null;  // 1 = repeating, 0 = paused
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
  assigned_to_me?: number; // >0 if the current viewer is assigned a subtask in this task
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
  instructions?: string; // owner → assignee (member read-only)
  completion_note?: string; // member writes when marking done; owner reads at sign-off
  assignee_emails?: string[];
  contact_ids?: string[];
  accepted_at?: number | null; // set when the owner signs off; null = awaiting sign-off
  due_date?: number | null;
}

export interface CompletedSubtask {
  id: string;
  task_id: string;
  text: string;
  accepted_at: number;
  completion_note?: string | null;
  due_date?: number | null;
  task_title: string;
  company_name?: string | null;
  company_id?: string | null;
  assignee_names?: string | null;
}

export interface ReportTask {
  text: string;
  status: string;
  due_date: number | null;
  accepted_at: number | null;
  assignee_names: string | null;
}
export interface ReportProject {
  id: string;
  title: string;
  company_name: string | null;
  company_id: string | null;
  created_at: number;
  due_date: number | null;
  tasks: ReportTask[];
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

export interface SubtaskComment {
  id: string;
  subtask_id: string;
  author_email: string;
  author_name?: string | null;
  body: string;
  created_at: number;
}

export interface TaskEvent {
  id: string;
  task_id: string;
  actor_email: string | null;
  actor_name?: string | null;
  type: string; // created | completed | reopened | subtask_added | subtask_done | accepted | reinstated | assigned
  detail: string;
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
