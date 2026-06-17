import type { Task, TaskStatus } from '../types';

const PRIORITY_COLORS: Record<string, string> = {
  high: '#dc2626',
  normal: '#a8a29e',
  low: '#d6d3d1',
};

const PRIORITY_LABEL: Record<string, string> = {
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

const STATUS_NEXT: Record<TaskStatus, TaskStatus> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
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
  selectMode,
  selectedIds,
  onToggleSelect,
}: Props) {
  return (
    <table className="task-table">
      <thead>
        <tr>
          {selectMode && <th className="col-check"></th>}
          <th>Status</th>
          <th>Title</th>
          <th>Company</th>
          <th>Contact</th>
          <th>Priority</th>
          <th>Date</th>
          {!selectMode && <th className="col-actions"></th>}
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => {
          const checked = selectedIds.has(task.id);
          const rowClass = [
            task.status === 'done' ? 'done' : '',
            !selectMode && selected?.id === task.id ? 'selected-row' : '',
            selectMode && checked ? 'checked' : '',
          ].filter(Boolean).join(' ');

          return (
            <tr
              key={task.id}
              className={rowClass}
              onClick={() => (selectMode ? onToggleSelect(task.id) : onSelect(task))}
            >
              {selectMode && (
                <td className="col-check">
                  <input
                    type="checkbox"
                    className="select-checkbox"
                    checked={checked}
                    onChange={() => onToggleSelect(task.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
              )}

              <td>
                <span
                  className={`status-pill ${task.status} ${selectMode ? 'static' : ''}`}
                  title={selectMode ? undefined : `Mark as ${STATUS_LABEL[STATUS_NEXT[task.status]]}`}
                  onClick={(e) => {
                    if (selectMode) return;
                    e.stopPropagation();
                    onStatusChange(task, STATUS_NEXT[task.status]);
                  }}
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

              {!selectMode && (
                <td className="col-actions">
                  <button
                    className="row-open"
                    onClick={(e) => { e.stopPropagation(); onSelect(task); }}
                  >
                    Open
                  </button>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
