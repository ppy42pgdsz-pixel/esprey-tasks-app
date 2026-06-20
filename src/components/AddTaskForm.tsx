import { useState } from 'react';
import type { Company } from '../types';

interface Props {
  companies: Company[];
  onSubmit: (data: {
    title: string;
    description?: string;
    company_id?: string;
    company_name?: string;
  }) => Promise<void>;
  onCancel: () => void;
}

export default function AddTaskForm({ companies, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const personalId = companies.find((c) => c.name.trim().toLowerCase() === 'personal')?.id ?? '';
  const [companyId, setCompanyId] = useState(personalId); // default to Personal
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
        company_id: companyId || undefined,
        company_name: selectedCompany?.name,
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
