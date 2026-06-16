import { useState } from 'react';
import type { Task, TaskStatus, TaskPriority, Company, Contact } from '../types';
import { api } from '../api';
import PeoplePicker from './PeoplePicker';

interface Props {
  task: Task;
  companies: Company[];
  contacts: Contact[];
  onClose: () => void;
  onUpdate: (task: Task) => void;
  onDelete: (task: Task) => void;
  onNewCompany: (name: string) => Promise<Company>;
  onNewContact: (data: { name: string; is_favourite?: boolean }) => Promise<Contact>;
}

export default function TaskDetail({ task, companies, contacts, onClose, onUpdate, onDelete, onNewCompany, onNewContact }: Props) {
  const [generatingReply, setGeneratingReply] = useState(false);
  const [editingReply, setEditingReply] = useState(false);
  const [replyText, setReplyText] = useState(task.draft_reply ?? '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descText, setDescText] = useState(task.description);
  const [addingCompany, setAddingCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');

  const selectedContact = contacts.find((c) => c.id === task.contact_id) ?? null;

  const handleGenerateReply = async () => {
    setGeneratingReply(true);
    try {
      const { draft_reply } = await api.generateDraftReply(task.id);
      setReplyText(draft_reply);
      onUpdate({ ...task, draft_reply });
    } finally {
      setGeneratingReply(false);
    }
  };

  const handleSaveReply = async () => {
    const updated = await api.updateTask(task.id, { draft_reply: replyText });
    onUpdate(updated);
    setEditingReply(false);
  };

  const handleSaveDesc = async () => {
    const updated = await api.updateTask(task.id, { description: descText });
    onUpdate(updated);
    setEditingDesc(false);
  };

  const handleStatusChange = async (status: TaskStatus) => {
    const updated = await api.updateTask(task.id, { status });
    onUpdate(updated);
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    const updated = await api.updateTask(task.id, { priority });
    onUpdate(updated);
  };

  const handleCompanyChange = async (companyId: string) => {
    const company = companies.find((c) => c.id === companyId);
    const updated = await api.updateTask(task.id, {
      company_id: companyId || null,
      company_name: company?.name ?? null,
    } as Parameters<typeof api.updateTask>[1]);
    onUpdate(updated);
  };

  const handleContactSelect = async (contact: Contact | null) => {
    const updated = await api.updateTask(task.id, {
      contact_id: contact?.id ?? null,
      contact_name: contact?.name ?? null,
    } as Parameters<typeof api.updateTask>[1]);
    onUpdate(updated);
  };

  const handleAddCompany = async () => {
    if (!newCompanyName.trim()) return;
    const company = await onNewCompany(newCompanyName.trim());
    await handleCompanyChange(company.id);
    setNewCompanyName('');
    setAddingCompany(false);
  };

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

  return (
    <aside className="task-detail">
      <div className="detail-header">
        <h2 className="detail-title">{task.title}</h2>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      <div className="detail-controls">
        <select
          className="select-input"
          value={task.status}
          onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
        >
          <option value="todo">To Do</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
        </select>
        <select
          className="select-input"
          value={task.priority}
          onChange={(e) => handlePriorityChange(e.target.value as TaskPriority)}
        >
          <option value="low">Low priority</option>
          <option value="normal">Normal priority</option>
          <option value="high">High priority</option>
        </select>
      </div>

      {/* Company */}
      <div className="detail-section">
        <div className="section-label">Company</div>
        {addingCompany ? (
          <div className="inline-add">
            <input
              className="text-input"
              placeholder="Company name"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              autoFocus
            />
            <button className="btn-primary sm" onClick={handleAddCompany}>Add</button>
            <button className="btn-secondary sm" onClick={() => setAddingCompany(false)}>Cancel</button>
          </div>
        ) : (
          <div className="company-select-row">
            <select
              className="select-input"
              value={task.company_id ?? ''}
              onChange={(e) => handleCompanyChange(e.target.value)}
            >
              <option value="">No company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="link-btn" onClick={() => setAddingCompany(true)}>+ new</button>
          </div>
        )}
      </div>

      {/* Contact */}
      <div className="detail-section">
        <PeoplePicker
          contacts={contacts}
          selected={selectedContact}
          onSelect={handleContactSelect}
          onNewContact={onNewContact}
        />
      </div>

      {task.source === 'email' && task.from_email && (
        <div className="detail-section">
          <div className="section-label">From</div>
          <div className="section-value muted">
            {task.from_name ? `${task.from_name} <${task.from_email}>` : task.from_email}
          </div>
          {task.original_subject && (
            <>
              <div className="section-label mt">Subject</div>
              <div className="section-value muted">{task.original_subject}</div>
            </>
          )}
        </div>
      )}

      <div className="detail-section">
        <div className="section-label-row">
          <span className="section-label">Notes</span>
          <button className="link-btn" onClick={() => setEditingDesc(!editingDesc)}>
            {editingDesc ? 'cancel' : 'edit'}
          </button>
        </div>
        {editingDesc ? (
          <div>
            <textarea
              className="textarea"
              value={descText}
              onChange={(e) => setDescText(e.target.value)}
              rows={4}
            />
            <button className="btn-primary sm" onClick={handleSaveDesc}>Save</button>
          </div>
        ) : (
          <div className="section-value" style={{ whiteSpace: 'pre-wrap' }}>
            {task.description || <span className="muted">No notes</span>}
          </div>
        )}
      </div>

      {task.source === 'email' && task.original_body && (
        <div className="detail-section">
          <div className="section-label">Original email</div>
          <div className="original-body">{task.original_body}</div>
        </div>
      )}

      <div className="detail-section">
        <div className="section-label-row">
          <span className="section-label">Draft reply</span>
          <div className="section-actions">
            {replyText && (
              <>
                <button className="link-btn" onClick={() => copyToClipboard(replyText)}>copy</button>
                <button className="link-btn" onClick={() => setEditingReply(!editingReply)}>
                  {editingReply ? 'cancel' : 'edit'}
                </button>
              </>
            )}
            <button className="link-btn" onClick={handleGenerateReply} disabled={generatingReply}>
              {generatingReply ? 'generating…' : replyText ? 'regenerate' : 'generate'}
            </button>
          </div>
        </div>

        {editingReply ? (
          <div>
            <textarea className="textarea" value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={8} />
            <button className="btn-primary sm" onClick={handleSaveReply}>Save</button>
          </div>
        ) : replyText ? (
          <div className="draft-reply">{replyText}</div>
        ) : (
          <div className="muted section-value">
            {task.source === 'email' ? 'Click generate to draft a reply with Claude.' : 'Add email context to generate a reply.'}
          </div>
        )}
      </div>

      <div className="detail-footer">
        <button className="btn-danger" onClick={() => { if (confirm('Delete this task?')) onDelete(task); }}>
          Delete task
        </button>
      </div>
    </aside>
  );
}
