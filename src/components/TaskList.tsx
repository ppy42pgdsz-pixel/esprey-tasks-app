import { useState } from 'react';
import type { Task, TaskStatus } from '../types';

const PRIORITY_COLORS: Record<string, string> = {
  high: '#dc2626',
  normal: '#a8a29e',
  low: '#d6d3d1',
};

const PRIORITY_LABEL: Record<string, string> = { high: 'High', normal: 'Normal', low: 'Low' };
const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

const STATUS_NEXT: Record<TaskStatus, TaskStatus> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
};
const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };
const STATUS_RANK: Record<TaskStatus, number> = { todo: 0, in_progress: 1, done: 2 };

type SortKey = 'status' | 'title' | 'company' | 'contact' | 'priority' | 'date';
type SortDir = 'asc' | 'desc';

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface Props {
  tasks: Task[];
  selected: Task | null;
  onSelect: (task: Task) => void;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  allSelected: boolean;
  onToggleSelectAll: () => void;
}

export default function TaskList({
  tasks,
  selected,
  onSelect,
  onStatusChange,
  selectedIds,
  onToggleSelect,
  allSelected,
  onToggleSelectAll,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = [...tasks].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'date': cmp = a.created_at - b.created_at; break;
      case 'title': cmp = a.title.localeCompare(b.title); break;
      case 'company': cmp = (a.company_name ?? '').localeCompare(b.company_name ?? ''); break;
      case 'contact': cmp = (a.contact_name ?? '').localeCompare(b.contact_name ?? ''); break;
      case 'priority': cmp = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]; break;
      case 'status': cmp = STATUS_RANK[a.status] - STATUS_RANK[b.status]; break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const sortBy = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'date' ? 'desc' : 'asc');
    }
  };

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '');

  const header = (key: SortKey, label: string) => (
    <th className="sortable" onClick={() => sortBy(key)}>
      <span className="th-inner">{label}<span className="sort-arrow">{arrow(key)}</span></span>
    </th>
  );

  return (
    <table className="task-table">
      <thead>
        <tr>
          <th className="col-check">
            <input
              type="checkbox"
              className="select-checkbox"
              checked={allSelected}
              onChange={onToggleSelectAll}
              aria-label="Select all"
            />
          </th>
          {header('status', 'Status')}
          {header('title', 'Title')}
          {header('company', 'Company')}
          {header('contact', 'Contact')}
          {header('priority', 'Priority')}
          {header('date', 'Date')}
          <th className="col-actions"></th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((task) => {
          const checked = selectedIds.has(task.id);
          const rowClass = [
            task.status === 'done' ? 'done' : '',
            selected?.id === task.id ? 'selected-row' : '',
            checked ? 'checked' : '',
          ].filter(Boolean).join(' ');

          return (
            <tr key={task.id} className={rowClass} onClick={() => onSelect(task)}>
              <td className="col-check" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  className="select-checkbox"
                  checked={checked}
                  onChange={() => onToggleSelect(task.id)}
                />
              </td>

              <td>
                <span
                  className={`status-pill ${task.status}`}
                  title={`Mark as ${STATUS_LABEL[STATUS_NEXT[task.status]]}`}
                  onClick={(e) => { e.stopPropagation(); onStatusChange(task, STATUS_NEXT[task.status]); }}
                >
                  {STATUS_LABEL[task.status]}
                </span>
              </td>

              <td>
                <div className="cell-title-row">
                  <span className="cell-title">{task.title}</span>
                  {task.source === 'email' && <span className="tag">email</span>}
                </div>
              </td>

              <td>{task.company_name ? <span className="tag">{task.company_name}</span> : <span className="cell-muted">—</span>}</td>

              <td>{task.contact_name ? task.contact_name : <span className="cell-muted">—</span>}</td>

              <td>
                <span className="priority-cell">
                  <span className="priority-dot" style={{ color: PRIORITY_COLORS[task.priority] }}>●</span>
                  {PRIORITY_LABEL[task.priority]}
                </span>
              </td>

              <td className="cell-muted">{formatDate(task.created_at)}</td>

              <td className="col-actions">
                <button className="row-open" onClick={(e) => { e.stopPropagation(); onSelect(task); }}>
                  Open
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
