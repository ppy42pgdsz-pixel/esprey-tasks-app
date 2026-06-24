import { useEffect, useState } from 'react';
import type { SubtaskComment, User } from '../types';
import { api } from '../api';

function fmt(ms: number) {
  return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

interface Props {
  subtaskId: string;
  users: User[];
}

export default function SubtaskComments({ subtaskId, users }: Props) {
  const [comments, setComments] = useState<SubtaskComment[]>([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listComments(subtaskId).then(setComments).catch(() => setComments([]));
  }, [subtaskId]);

  const name = (email: string, fallback?: string | null) =>
    users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.name ?? fallback ?? email.split('@')[0];

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const c = await api.addComment(subtaskId, body);
      setComments((prev) => [...prev, c]);
      setText('');
      setOpen(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not add comment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="subtask-comments">
      <button className="link-btn comments-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Comments ({comments.length})
      </button>
      {open && (
        <div className="comments-thread">
          {comments.map((c) => (
            <div key={c.id} className="comment">
              <div className="comment-head">
                <strong>{name(c.author_email, c.author_name)}</strong>
                <span className="muted"> · {fmt(c.created_at)}</span>
              </div>
              <div className="comment-body">{c.body}</div>
            </div>
          ))}
          <div className="comment-add">
            <textarea
              className="subtask-notes"
              rows={2}
              placeholder="Add a comment…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn-primary sm" onClick={add} disabled={busy || !text.trim()}>Comment</button>
          </div>
        </div>
      )}
    </div>
  );
}
