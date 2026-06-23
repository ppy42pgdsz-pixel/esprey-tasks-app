import type { CompletedSubtask } from '../types';

// accepted_at is a real moment (not a UTC-midnight calendar date), so format it
// in local time.
function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface Props {
  items: CompletedSubtask[];
  onOpen: (taskId: string, subtaskId: string) => void;
}

export default function CompletedSubtasks({ items, onOpen }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="completed-subs">
      <h3 className="completed-subs-title">Signed-off subtasks · {items.length}</h3>
      <ul className="completed-subs-list">
        {items.map((s) => (
          <li
            key={s.id}
            className="completed-sub"
            onClick={() => onOpen(s.task_id, s.id)}
            title="Open this subtask"
          >
            <span className="completed-sub-check">✓</span>
            <div className="completed-sub-body">
              <div className="completed-sub-name">{s.text}</div>
              <div className="completed-sub-meta">
                <span className="completed-sub-task">{s.task_title}</span>
                {s.assignee_names && <span> · {s.assignee_names}</span>}
                <span> · signed off {fmtWhen(s.accepted_at)}</span>
              </div>
              {s.completion_note && <div className="completed-sub-note">{s.completion_note}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
