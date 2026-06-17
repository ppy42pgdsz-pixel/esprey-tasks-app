import type { Task, TaskStatus } from '../types';

const PRIORITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  normal: '#64748b',
  low: '#94a3b8',
};

const STATUS_NEXT: Record<TaskStatus, TaskStatus | null> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: null,
};

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface Props {
  tasks: Task[];
  selected: Task | null;
  onSelect: (task: Task) => void;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  onDelete: (task: Task) => void;
  selectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}

export default function TaskList({
  tasks,
  selected,
  onSelect,
  onStatusChange,
  onDelete,
  selectMode,
  selectedIds,
  onToggleSelect,
}: Props) {
  return (
    <ul className="task-list">
      {tasks.map((task) => {
        const nextStatus = STATUS_NEXT[task.status];
        const checked = selectedIds.has(task.id);
        return (
          <li
            key={task.id}
            className={`task-item ${!selectMode && selected?.id === task.id ? 'selected' : ''} ${task.status === 'done' ? 'done' : ''} ${selectMode && checked ? 'checked' : ''}`}
            onClick={() => (selectMode ? onToggleSelect(task.id) : onSelect(task))}
          >
            <div className="task-item-left">
              {selectMode ? (
                <input
                  type="checkbox"
                  className="select-checkbox"
                  checked={checked}
                  onChange={() => onToggleSelect(task.id)}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : nextStatus ? (
                <button
                  className="check-btn"
                  title={`Mark as ${nextStatus}`}
                  onClick={(e) => { e.stopPropagation(); onStatusChange(task, nextStatus); }}
                >
                  {task.status === 'todo' ? '○' : '◑'}
                </button>
              ) : (
                <button
                  className="check-btn done-btn"
                  title="Mark as todo"
                  onClick={(e) => { e.stopPropagation(); onStatusChange(task, 'todo'); }}
                >
                  ●
                </button>
              )}
            </div>
            <div className="task-item-body">
              <div className="task-title">{task.title}</div>
              <div className="task-meta">
                <span
                  className="priority-dot"
                  style={{ color: PRIORITY_COLORS[task.priority] }}
                  title={task.priority}
                >●</span>
                {task.company_name && <span className="tag">{task.company_name}</span>}
                {task.contact_name && <span className="muted">{task.contact_name}</span>}
                {task.source === 'email' && <span className="tag">email</span>}
                {task.due_date && <span className="muted">{formatDate(task.due_date)}</span>}
                <span className="muted">{formatDate(task.created_at)}</span>
              </div>
            </div>
            {!selectMode && (
              <button
                className="delete-btn"
                title="Delete"
                onClick={(e) => { e.stopPropagation(); onDelete(task); }}
              >
                ×
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
