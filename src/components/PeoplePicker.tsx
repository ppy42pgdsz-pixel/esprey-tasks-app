import type { Contact } from '../types';

interface Props {
  contacts: Contact[];
  selected: Contact | null;
  onSelect: (contact: Contact | null) => void;
}

export default function PeoplePicker({ contacts, selected, onSelect }: Props) {
  const favourites = contacts.filter((c) => c.is_favourite === 1);
  const others = contacts.filter((c) => c.is_favourite !== 1);

  return (
    <div className="people-picker">
      <div className="section-label-row">
        <span className="section-label">Contact</span>
        {selected && (
          <button className="link-btn" onClick={() => onSelect(null)}>clear</button>
        )}
      </div>

      {contacts.length === 0 ? (
        <p className="muted">No contacts yet. Add them in Settings.</p>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
