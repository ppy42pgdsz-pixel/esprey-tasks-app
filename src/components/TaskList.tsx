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
}

export default function TaskList({ tasks, selected, onSelect, onStatusChange, onDelete }: Props) {
  return (
    <ul className="task-list">
      {tasks.map((task) => {
        const nextStatus = STATUS_NEXT[task.status];
        return (
          <li
            key={task.id}
            className={`task-item ${selected?.id === task.id ? 'selected' : ''} ${task.status === 'done' ? 'done' : ''}`}
            onClick={() => onSelect(task)}
          >
            <div className="task-item-left">
              {nextStatus ? (
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
                {task.source === 'email' && <span className="tag">email</span>}
                {task.due_date && <span className="muted">{formatDate(task.due_date)}</span>}
                <span className="muted">{formatDate(task.created_at)}</span>
              </div>
            </div>
            <button
              className="delete-btn"
              title="Delete"
              onClick={(e) => { e.stopPropagation(); onDelete(task); }}
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
