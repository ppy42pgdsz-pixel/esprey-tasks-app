import { useState } from 'react';
import type { TaskPriority, Company, Contact } from '../types';
import PeoplePicker from './PeoplePicker';

interface Props {
  companies: Company[];
  contacts: Contact[];
  onSubmit: (data: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    company_id?: string;
    company_name?: string;
    contact_id?: string;
    contact_name?: string;
  }) => Promise<void>;
  onCancel: () => void;
}

export default function AddTaskForm({ companies, contacts, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const personalId = companies.find((c) => c.name.trim().toLowerCase() === 'personal')?.id ?? '';
  const [companyId, setCompanyId] = useState(personalId); // default to Personal
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedCompany = companies.find((c) => c.id === companyId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        company_id: companyId || undefined,
        company_name: selectedCompany?.name,
        contact_id: selectedContact?.id,
        contact_name: selectedContact?.name,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="add-form-overlay">
      <form className="add-form" onSubmit={handleSubmit}>
        <h3 className="form-title">New Task</h3>

        <input
          className="text-input"
          placeholder="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />

        <textarea
          className="textarea"
          placeholder="Notes (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />

        <div className="form-row">
          <select
            className="select-input"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
          >
            <option value="low">Low priority</option>
            <option value="normal">Normal priority</option>
            <option value="high">High priority</option>
          </select>

          <div className="company-field">
            <select
              className="select-input"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              {!personalId && <option value="">No company</option>}
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <PeoplePicker
          contacts={contacts}
          selected={selectedContact}
          onSelect={setSelectedContact}
        />

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving || !title.trim()}>
            {saving ? 'Adding…' : 'Add Task'}
          </button>
        </div>
      </form>
    </div>
  );
}
