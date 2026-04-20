import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import Avatar from '../components/Avatar';
import type { Bio, UserSummary, Profile } from '../api/types';

interface Card {
  user: UserSummary;
  profile: Profile;
  bio: Bio;
}

export default function RecommendationsPage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  async function load() {
    setError(null);
    setCards(null);
    try {
      const ids = await api<{ id: string }[]>('/recommendations');
      const data = await Promise.all(
        ids.map(async ({ id }) => {
          const [user, profile, bio] = await Promise.all([
            api<UserSummary>(`/users/${id}`),
            api<Profile>(`/users/${id}/profile`),
            api<Bio>(`/users/${id}/bio`),
          ]);
          return { user, profile, bio };
        })
      );
      setCards(data);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load');
      setCards([]);
    }
  }
  useEffect(() => { load(); }, []);

  async function dismiss(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await api(`/recommendations/${id}/dismiss`, { method: 'POST' });
      setCards((prev) => prev?.filter((c) => c.user.id !== id) ?? prev);
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  async function connect(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await api(`/connections/request/${id}`, { method: 'POST' });
      setCards((prev) => prev?.filter((c) => c.user.id !== id) ?? prev);
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  return (
    <div className="container">
      <h1>Recommendations</h1>
      {error && (
        <div className="card">
          <p style={{ color: 'crimson' }}>{error}</p>
          {error.toLowerCase().includes('complete') && (
            <p><Link to="/me">Complete your profile →</Link></p>
          )}
        </div>
      )}
      {cards === null && <p>Loading...</p>}
      {cards && cards.length === 0 && !error && (
        <p>No recommendations right now. Try again later or tweak your profile.</p>
      )}
      <div className="col">
        {cards?.map((c) => (
          <div className="card row" key={c.user.id} style={{ alignItems: 'flex-start' }}>
            <Avatar url={c.user.avatarUrl} size={64} />
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0 }}>
                <Link to={`/users/${c.user.id}`}>{c.user.displayName}</Link>
              </h3>
              <p className="muted">
                {[c.profile.age, c.profile.gender, c.profile.city, c.bio.gymName].filter(Boolean).join(' · ')}
              </p>
              <p>
                {c.bio.workoutTypes.slice(0, 4).map((w) => <span key={w} className="pill">{w}</span>)}
                {' '}<span className="pill">{c.bio.experienceLevel}</span>
              </p>
              <p className="muted">Looking for: {c.bio.lookingFor.join(', ') || '—'}</p>
            </div>
            <div className="col">
              <button onClick={() => connect(c.user.id)} disabled={busy[c.user.id]}>Connect</button>
              <button onClick={() => dismiss(c.user.id)} disabled={busy[c.user.id]}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
      {cards && cards.length > 0 && <button onClick={load}>Refresh</button>}
    </div>
  );
}
