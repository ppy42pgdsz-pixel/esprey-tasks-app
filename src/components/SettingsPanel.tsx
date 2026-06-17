import { useState } from 'react';
import type { Company, Contact, User, UserRole } from '../types';

interface Props {
  companies: Company[];
  contacts: Contact[];
  me: { email: string; name: string; role: UserRole } | null;
  users: User[];
  onClose: () => void;
  onCreateCompany: (name: string) => Promise<Company>;
  onRenameCompany: (id: string, name: string) => Promise<void>;
  onDeleteCompany: (id: string) => Promise<void>;
  onCreateContact: (data: { name: string; email?: string; company_id?: string; is_favourite?: boolean }) => Promise<Contact>;
  onUpdateContact: (id: string, data: { name?: string; email?: string | null; company_id?: string | null; is_favourite?: boolean }) => Promise<void>;
  onDeleteContact: (id: string) => Promise<void>;
  onCreateUser: (data: { name: string; email: string; role: UserRole }) => Promise<void>;
  onUpdateUser: (email: string, data: { name?: string; role?: UserRole }) => Promise<void>;
  onDeleteUser: (email: string) => Promise<void>;
}

interface ContactDraft {
  name: string;
  email: string;
  company_id: string;
}

export default function SettingsPanel({
  companies,
  contacts,
  me,
  users,
  onClose,
  onCreateCompany,
  onRenameCompany,
  onDeleteCompany,
  onCreateContact,
  onUpdateContact,
  onDeleteContact,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
}: Props) {
  const isAdmin = me?.role === 'admin';

  // ─── Team ───
  const [newUser, setNewUser] = useState<{ name: string; email: string; role: UserRole }>({ name: '', email: '', role: 'member' });
  // ─── Companies ───
  const [newCompany, setNewCompany] = useState('');
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCompanyName, setEditingCompanyName] = useState('');

  // ─── Contacts ───
  const [newContact, setNewContact] = useState<ContactDraft>({ name: '', email: '', company_id: '' });
  const [newContactFav, setNewContactFav] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactDraft, setContactDraft] = useState<ContactDraft>({ name: '', email: '', company_id: '' });

  const [busy, setBusy] = useState(false);

  const companyName = (id: string | null) => companies.find((c) => c.id === id)?.name ?? null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  // ─── Company handlers ───
  const addCompany = () =>
    run(async () => {
      if (!newCompany.trim()) return;
      await onCreateCompany(newCompany.trim());
      setNewCompany('');
    });

  const startEditCompany = (c: Company) => {
    setEditingCompanyId(c.id);
    setEditingCompanyName(c.name);
  };

  const saveCompany = () =>
    run(async () => {
      if (!editingCompanyName.trim() || !editingCompanyId) return;
      await onRenameCompany(editingCompanyId, editingCompanyName.trim());
      setEditingCompanyId(null);
    });

  const removeCompany = (c: Company) =>
    run(async () => {
      if (!confirm(`Delete "${c.name}"? Tasks assigned to it will be unassigned (the company will be cleared from them). The tasks themselves are kept.`)) return;
      await onDeleteCompany(c.id);
    });

  // ─── Contact handlers ───
  const addContact = () =>
    run(async () => {
      if (!newContact.name.trim()) return;
      await onCreateContact({
        name: newContact.name.trim(),
        email: newContact.email.trim() || undefined,
        company_id: newContact.company_id || undefined,
        is_favourite: newContactFav,
      });
      setNewContact({ name: '', email: '', company_id: '' });
      setNewContactFav(false);
    });

  const startEditContact = (c: Contact) => {
    setEditingContactId(c.id);
    setContactDraft({ name: c.name, email: c.email ?? '', company_id: c.company_id ?? '' });
  };

  const saveContact = () =>
    run(async () => {
      if (!contactDraft.name.trim() || !editingContactId) return;
      await onUpdateContact(editingContactId, {
        name: contactDraft.name.trim(),
        email: contactDraft.email.trim() || null,
        company_id: contactDraft.company_id || null,
      });
      setEditingContactId(null);
    });

  const toggleFav = (c: Contact) =>
    run(() => onUpdateContact(c.id, { is_favourite: c.is_favourite !== 1 }));

  const removeContact = (c: Contact) =>
    run(async () => {
      if (!confirm(`Delete "${c.name}"? Tasks assigned to them will be unassigned (the contact will be cleared from them). The tasks themselves are kept.`)) return;
      await onDeleteContact(c.id);
    });

  // ─── Team ───
  const addUser = () =>
    run(async () => {
      const name = newUser.name.trim();
      const email = newUser.email.trim();
      if (!name || !email) return;
      await onCreateUser({ name, email, role: newUser.role });
      setNewUser({ name: '', email: '', role: 'member' });
    });

  const toggleRole = (u: User) =>
    run(() => onUpdateUser(u.email, { role: u.role === 'admin' ? 'member' : 'admin' }));

  const removeUser = (u: User) =>
    run(async () => {
      if (!confirm(`Remove ${u.name} (${u.email}) from the team?`)) return;
      await onDeleteUser(u.email);
    });

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        {me && <p className="muted mb">Signed in as {me.name} ({me.role})</p>}

        {/* ─── Team (admin only) ─── */}
        {isAdmin && (
          <section className="settings-section">
            <h3 className="settings-section-title">Team (employees)</h3>
            <div className="settings-add-contact">
              <input
                className="text-input"
                placeholder="Name"
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
              />
              <input
                className="text-input"
                placeholder="Email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              />
              <select
                className="select-input"
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button className="btn-primary sm" onClick={addUser} disabled={busy || !newUser.name.trim() || !newUser.email.trim()}>Add</button>
            </div>

            {users.length === 0 ? (
              <p className="muted mt">No employees yet.</p>
            ) : (
              <ul className="settings-list">
                {users.map((u) => (
                  <li key={u.email} className="settings-row">
                    <div className="settings-row-name">
                      <span>{u.name}</span>
                      <span className="settings-row-sub">{u.email} · {u.role}</span>
                    </div>
                    <div className="settings-row-actions">
                      <button className="link-btn" onClick={() => toggleRole(u)} disabled={busy}>
                        {u.role === 'admin' ? 'Make member' : 'Make admin'}
                      </button>
                      <button className="link-btn danger" onClick={() => removeUser(u)} disabled={busy}>Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted mt">Adding someone here lists them for sharing. Enabling their actual login (Cloudflare Access) is the next step.</p>
          </section>
        )}

        {/* ─── Companies ─── */}
        <section className="settings-section">
          <h3 className="settings-section-title">Companies</h3>

          <div className="inline-add">
            <input
              className="text-input"
              placeholder="New company name"
              value={newCompany}
              onChange={(e) => setNewCompany(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCompany()}
            />
            <button className="btn-primary sm" onClick={addCompany} disabled={busy || !newCompany.trim()}>Add</button>
          </div>

          {companies.length === 0 ? (
            <p className="muted mt">No companies yet.</p>
          ) : (
            <ul className="settings-list">
              {companies.map((c) => (
                <li key={c.id} className="settings-row">
                  {editingCompanyId === c.id ? (
                    <div className="inline-add full">
                      <input
                        className="text-input"
                        value={editingCompanyName}
                        onChange={(e) => setEditingCompanyName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveCompany()}
                        autoFocus
                      />
                      <button className="btn-primary sm" onClick={saveCompany} disabled={busy}>Save</button>
                      <button className="btn-secondary sm" onClick={() => setEditingCompanyId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <span className="settings-row-name">{c.name}</span>
                      <div className="settings-row-actions">
                        <button className="link-btn" onClick={() => startEditCompany(c)}>Edit</button>
                        <button className="link-btn danger" onClick={() => removeCompany(c)} disabled={busy}>Delete</button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ─── Contacts ─── */}
        <section className="settings-section">
          <h3 className="settings-section-title">Contacts</h3>

          <div className="settings-add-contact">
            <input
              className="text-input"
              placeholder="Name"
              value={newContact.name}
              onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
            />
            <input
              className="text-input"
              placeholder="Email (optional)"
              value={newContact.email}
              onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
            />
            <select
              className="select-input"
              value={newContact.company_id}
              onChange={(e) => setNewContact({ ...newContact, company_id: e.target.value })}
            >
              <option value="">No company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <label className="checkbox-label">
              <input type="checkbox" checked={newContactFav} onChange={(e) => setNewContactFav(e.target.checked)} />
              Favourite
            </label>
            <button className="btn-primary sm" onClick={addContact} disabled={busy || !newContact.name.trim()}>Add</button>
          </div>

          {contacts.length === 0 ? (
            <p className="muted mt">No contacts yet.</p>
          ) : (
            <ul className="settings-list">
              {contacts.map((c) => (
                <li key={c.id} className="settings-row">
                  {editingContactId === c.id ? (
                    <div className="settings-add-contact full">
                      <input
                        className="text-input"
                        placeholder="Name"
                        value={contactDraft.name}
                        onChange={(e) => setContactDraft({ ...contactDraft, name: e.target.value })}
                        autoFocus
                      />
                      <input
                        className="text-input"
                        placeholder="Email (optional)"
                        value={contactDraft.email}
                        onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })}
                      />
                      <select
                        className="select-input"
                        value={contactDraft.company_id}
                        onChange={(e) => setContactDraft({ ...contactDraft, company_id: e.target.value })}
                      >
                        <option value="">No company</option>
                        {companies.map((co) => (
                          <option key={co.id} value={co.id}>{co.name}</option>
                        ))}
                      </select>
                      <button className="btn-primary sm" onClick={saveContact} disabled={busy}>Save</button>
                      <button className="btn-secondary sm" onClick={() => setEditingContactId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <button
                        className={`fav-star ${c.is_favourite === 1 ? 'on' : ''}`}
                        onClick={() => toggleFav(c)}
                        disabled={busy}
                        aria-label={c.is_favourite === 1 ? 'Unfavourite' : 'Favourite'}
                        title={c.is_favourite === 1 ? 'Unfavourite' : 'Mark as favourite'}
                      >
                        {c.is_favourite === 1 ? '★' : '☆'}
                      </button>
                      <div className="settings-row-name">
                        <span>{c.name}</span>
                        <span className="settings-row-sub">
                          {[c.email, companyName(c.company_id)].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </div>
                      <div className="settings-row-actions">
                        <button className="link-btn" onClick={() => startEditContact(c)}>Edit</button>
                        <button className="link-btn danger" onClick={() => removeContact(c)} disabled={busy}>Delete</button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
