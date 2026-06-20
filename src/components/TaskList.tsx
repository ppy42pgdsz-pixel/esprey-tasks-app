import { Fragment, useState, useEffect } from 'react';
import type { Task, TaskStatus, Subtask, User } from '../types';
import { api } from '../api';

const STATUS_NEXT: Record<TaskStatus, TaskStatus> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
};
const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };
const STATUS_RANK: Record<TaskStatus, number> = { todo: 0, in_progress: 1, done: 2 };

const COL_COUNT = 7; // check, status, title, company, assigned, due, actions

type SortKey = 'status' | 'title' | 'company' | 'due';
type SortDir = 'asc' | 'desc';

// Distinct soft colours so each company is easy to tell apart at a glance.
const COMPANY_COLORS: Array<[string, string]> = [
  ['#e0e7ff', '#3730a3'], ['#fce7f3', '#9d174d'], ['#dcfce7', '#166534'],
  ['#fef3c7', '#92400e'], ['#dbeafe', '#1e40af'], ['#f3e8ff', '#6b21a8'],
  ['#ffe4e6', '#9f1239'], ['#ccfbf1', '#115e59'], ['#fee2e2', '#991b1b'], ['#cffafe', '#155e75'],
];
function companyColor(key: string): [string, string] {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return COMPANY_COLORS[h % COMPANY_COLORS.length];
}

// Due dates are stored as UTC midnight (a calendar day, not a moment), so they
// must be formatted in UTC to avoid shifting a day in non-UTC timezones. Used
// for both task and subtask due dates.
function formatDueDate(ms: number) {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
const todayUtcStart = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
// The earliest relevant due date for a task row: its own due date or the
// soonest open subtask due date.
function nextDue(task: Task): number | null {
  const dues = [task.due_date, task.min_subtask_due].filter((d): d is number => typeof d === 'number');
  return dues.length ? Math.min(...dues) : null;
}

interface Props {
  tasks: Task[];
  selected: Task | null;
  onSelect: (task: Task) => void;
  onSelectSubtask: (task: Task, subtaskId: string) => void;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onSubtaskProgress?: (taskId: string, total: number, done: number, pending?: number) => void;
  meEmail: string;
  users: User[];
  showCompleted: boolean;
}

export default function TaskList({
  tasks,
  selected,
  onSelect,
  onSelectSubtask,
  onStatusChange,
  selectedIds,
  onToggleSelect,
  allSelected,
  onToggleSelectAll,
  onSubtaskProgress,
  meEmail,
  users,
  showCompleted,
}: Props) {
  const userName = (email: string) =>
    users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.name ?? email.split('@')[0];
  const [sortKey, setSortKey] = useState<SortKey>('due');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [subsByTask, setSubsByTask] = useState<Record<string, Subtask[]>>({});

  // Whenever the task list refreshes (auto-refresh or an edit), refetch the
  // subtasks of any expanded rows so their status, assignees, and due dates
  // never go stale relative to the parent row.
  useEffect(() => {
    expanded.forEach((taskId) => {
      if (!tasks.find((t) => t.id === taskId)) return;
      api.listSubtasks(taskId)
        .then((subs) => setSubsByTask((prev) => ({ ...prev, [taskId]: subs })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, expanded]);

  const sorted = [...tasks].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'due': {
        // Rows with a due date first (soonest first in asc); undated last.
        const da = nextDue(a); const db = nextDue(b);
        if (da == null && db == null) cmp = b.created_at - a.created_at;
        else if (da == null) cmp = 1;
        else if (db == null) cmp = -1;
        else cmp = da - db;
        break;
      }
      case 'title': cmp = a.title.localeCompare(b.title); break;
      case 'company': cmp = (a.company_name ?? '').localeCompare(b.company_name ?? ''); break;
      case 'status': cmp = STATUS_RANK[a.status] - STATUS_RANK[b.status]; break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const sortBy = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '');
  const header = (key: SortKey, label: string) => (
    <th className="sortable" onClick={() => sortBy(key)}>
      <span className="th-inner">{label}<span className="sort-arrow">{arrow(key)}</span></span>
    </th>
  );

  const expandableIds = sorted.filter((t) => (t.subtask_total ?? 0) > 0).map((t) => t.id);
  const allExpanded = expandableIds.length > 0 && expandableIds.every((id) => expanded.has(id));
  const toggleAllExpand = async () => {
    if (allExpanded) { setExpanded(new Set()); return; }
    setExpanded(new Set(expandableIds));
    const missing = expandableIds.filter((id) => !subsByTask[id]);
    const pairs = await Promise.all(
      missing.map((id) => api.listSubtasks(id).then((s) => [id, s] as const).catch(() => [id, [] as Subtask[]] as const)),
    );
    if (pairs.length) setSubsByTask((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
  };

  const toggleExpand = async (taskId: string) => {
    const willExpand = !expanded.has(taskId);
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(taskId)) n.delete(taskId);
      else n.add(taskId);
      return n;
    });
    if (willExpand) {
      try {
        const subs = await api.listSubtasks(taskId);
        setSubsByTask((prev) => ({ ...prev, [taskId]: subs }));
      } catch {
        setSubsByTask((prev) => ({ ...prev, [taskId]: [] }));
      }
    }
  };

  const commitSubs = (taskId: string, list: Subtask[]) => {
    setSubsByTask((prev) => ({ ...prev, [taskId]: list }));
    onSubtaskProgress?.(
      taskId,
      list.length,
      list.filter((s) => s.status === 'done').length,
      list.filter((s) => s.status === 'done' && !s.accepted_at).length,
    );
  };

  const cycleSub = async (taskId: string, s: Subtask) => {
    const updated = await api.updateSubtask(s.id, { status: STATUS_NEXT[s.status] });
    commitSubs(taskId, (subsByTask[taskId] ?? []).map((x) => (x.id === updated.id ? updated : x)));
  };

  const delSub = async (taskId: string, id: string) => {
    await api.deleteSubtask(id);
    commitSubs(taskId, (subsByTask[taskId] ?? []).filter((x) => x.id !== id));
  };

  return (
    <>
      {expandableIds.length > 0 && (
        <div className="list-subcontrols">
          <button className="link-btn" onClick={toggleAllExpand}>
            {allExpanded ? '▾ Collapse all subtasks' : '▸ Expand all subtasks'}
          </button>
        </div>
      )}
      <table className="task-table">
      <thead>
        <tr>
          <th className="col-check">
            <input type="checkbox" className="select-checkbox" checked={allSelected} onChange={onToggleSelectAll} aria-label="Select all" />
          </th>
          {header('status', 'Status')}
          {header('title', 'Title')}
          {header('company', 'Company')}
          <th>Assigned</th>
          {header('due', 'Due')}
          <th className="col-actions"></th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((task) => {
          const checked = selectedIds.has(task.id);
          const isExpanded = expanded.has(task.id);
          const hasSubs = (task.subtask_total ?? 0) > 0;
          const rowClass = [
            task.status === 'done' ? 'done' : '',
            selected?.id === task.id ? 'selected-row' : '',
            checked ? 'checked' : '',
          ].filter(Boolean).join(' ');

          return (
            <Fragment key={task.id}>
              <tr className={rowClass} onClick={() => onSelect(task)}>
                <td className="col-check" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="select-checkbox" checked={checked} onChange={() => onToggleSelect(task.id)} />
                </td>

                <td>
                  {(() => {
                    const ownsTask = (task.owner_email ?? '').toLowerCase() === meEmail || !task.owner_email;
                    return (
                      <span
                        className={`status-pill ${task.status}${ownsTask ? '' : ' static'}`}
                        title={ownsTask ? `Mark as ${STATUS_LABEL[STATUS_NEXT[task.status]]}` : `Owned by ${task.owner_name || task.owner_email}`}
                        onClick={ownsTask ? (e) => { e.stopPropagation(); onStatusChange(task, STATUS_NEXT[task.status]); } : undefined}
                      >
                        {STATUS_LABEL[task.status]}
                      </span>
                    );
                  })()}
                </td>

                <td>
                  <div className="cell-title-row">
                    {hasSubs && (
                      <button
                        className="expand-chevron"
                        onClick={(e) => { e.stopPropagation(); toggleExpand(task.id); }}
                        aria-label="Toggle subtasks"
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                    )}
                    <span className="cell-title">{task.title}</span>
                    {task.source === 'email' && <span className="tag">email</span>}
                    {task.owner_email && task.owner_email.toLowerCase() !== meEmail && (
                      <span className="tag owner-tag">from {task.owner_name || task.owner_email}</span>
                    )}
                    {hasSubs && (
                      <span className="subtask-badge">☑ {task.subtask_done ?? 0}/{task.subtask_total}</span>
                    )}
                    {(task.pending_signoff ?? 0) > 0 && (task.owner_email ?? '').toLowerCase() === meEmail && (
                      <span className="signoff-badge">{task.pending_signoff} to sign off</span>
                    )}
                  </div>
                </td>

                <td>
                  {task.company_name ? (() => {
                    const [bg, fg] = companyColor(task.company_id || task.company_name);
                    return <span className="tag" style={{ background: bg, color: fg }}>{task.company_name}</span>;
                  })() : <span className="cell-muted">—</span>}
                </td>
                <td>
                  {(() => {
                    const members = (task.assignee_names ?? '').split(',').map((s) => s.trim()).filter(Boolean);
                    if (members.length === 0) return <span className="cell-muted">—</span>;
                    return (
                      <span className="assigned-cell">
                        {members.map((n) => <span key={`m-${n}`} className="assignee-chip">{n}</span>)}
                      </span>
                    );
                  })()}
                </td>
                <td>
                  {(() => {
                    const d = nextDue(task);
                    if (d == null) return <span className="cell-muted">—</span>;
                    const overdue = d < todayUtcStart();
                    return <span className={overdue ? 'due-overdue' : 'cell-muted'}>{formatDueDate(d)}</span>;
                  })()}
                </td>
                <td className="col-actions">
                  <button className="row-open" onClick={(e) => { e.stopPropagation(); onSelect(task); }}>Open</button>
                </td>
              </tr>

              {isExpanded && !subsByTask[task.id] && (
                <tr className="subtask-row">
                  <td colSpan={COL_COUNT}><div className="subtask-line"><span className="cell-muted">Loading…</span></div></td>
                </tr>
              )}

              {isExpanded && (subsByTask[task.id] ?? []).filter((s) => showCompleted || !s.accepted_at).map((s) => (
                <tr key={s.id} className="subtask-row">
                  <td colSpan={COL_COUNT}>
                    <div className={`subtask-line ${s.status === 'done' ? 'done' : ''}`}>
                      <span
                        className={`status-pill ${s.status}`}
                        title={`Mark as ${STATUS_LABEL[STATUS_NEXT[s.status]]}`}
                        onClick={() => cycleSub(task.id, s)}
                      >
                        {STATUS_LABEL[s.status]}
                      </span>
                      <span
                        className="subtask-row-text clickable"
                        onClick={() => onSelectSubtask(task, s.id)}
                        title="Open this subtask"
                      >
                        {s.text}
                      </span>
                      {(s.assignee_emails ?? []).map((em) => (
                        <span key={em} className="assignee-chip">{userName(em)}</span>
                      ))}
                      {s.due_date && <span className="due-chip">Due {formatDueDate(s.due_date)}</span>}
                      <button className="subtask-del" onClick={() => delSub(task.id, s.id)} title="Delete subtask" aria-label="Delete subtask">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </Fragment>
          );
        })}
      </tbody>
      </table>
    </>
  );
}
