import { useState } from 'react';
import type { Contact } from '../types';

interface Props {
  contacts: Contact[];
  selected: Contact | null;
  onSelect: (contact: Contact | null) => void;
  onNewContact: (data: { name: string; is_favourite?: boolean }) => Promise<Contact>;
}

export default function PeoplePicker({ contacts, selected, onSelect, onNewContact }: Props) {
  const [addingContact, setAddingContact] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFavourite, setNewFavourite] = useState(false);

  const favourites = contacts.filter((c) => c.is_favourite === 1);
  const others = contacts.filter((c) => c.is_favourite !== 1);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    const contact = await onNewContact({ name: newName.trim(), is_favourite: newFavourite });
    onSelect(contact);
    setNewName('');
    setNewFavourite(false);
    setAddingContact(false);
  };

  return (
    <div className="people-picker">
      <div className="section-label-row">
        <span className="section-label">Contact</span>
        {selected && (
          <button className="link-btn" onClick={() => onSelect(null)}>clear</button>
        )}
      </div>

      {favourites.length > 0 && (
        <div className="people-group">
          <div className="people-group-label">Favourites</div>
          <div className="people-chips">
            {favourites.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`person-chip ${selected?.id === c.id ? 'selected' : ''}`}
                onClick={() => onSelect(selected?.id === c.id ? null : c)}
              >
                ★ {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div className="people-group">
          {favourites.length > 0 && <div className="people-group-label">Others</div>}
          <div className="people-chips">
            {others.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`person-chip ${selected?.id === c.id ? 'selected' : ''}`}
                onClick={() => onSelect(selected?.id === c.id ? null : c)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {addingContact ? (
        <div className="inline-add mt">
          <input
            className="text-input"
            placeholder="Contact name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={newFavourite}
              onChange={(e) => setNewFavourite(e.target.checked)}
            />
            Favourite
          </label>
          <button type="button" className="btn-primary sm" onClick={handleAdd}>Add</button>
          <button type="button" className="btn-secondary sm" onClick={() => setAddingContact(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="link-btn mt" onClick={() => setAddingContact(true)}>
          + add contact
        </button>
      )}
    </div>
  );
}
