import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import Avatar from '../components/Avatar';
import type { Bio, Profile, UserSummary, Presence } from '../api/types';
import { useSocket } from '../contexts/SocketContext';

export default function UserViewPage() {
  const { id } = useParams<{ id: string }>();
  const { presence } = useSocket();
  const nav = useNavigate();

  const [user, setUser] = useState<UserSummary | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bio, setBio] = useState<Bio | null>(null);
  const [pres, setPres] = useState<Presence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'none' | 'pending' | 'connected' | 'incoming'>('none');
  const [chatId, setChatId] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    setError(null);
    try {
      const [u, p, b, pr] = await Promise.all([
        api<UserSummary>(`/users/${id}`),
        api<Profile>(`/users/${id}/profile`),
        api<Bio>(`/users/${id}/bio`),
        api<Presence>(`/users/${id}/presence`),
      ]);
      setUser(u); setProfile(p); setBio(b); setPres(pr);

      // Figure relationship status
      const [conns, outgoing, incoming, chats] = await Promise.all([
        api<{ id: string }[]>('/connections'),
        api<{ id: string }[]>('/connections/outgoing'),
        api<{ id: string }[]>('/connections/requests'),
        api<{ id: string; otherId: string }[]>('/chats'),
      ]);
      if (conns.some((c) => c.id === id)) setStatus('connected');
      else if (outgoing.some((c) => c.id === id)) setStatus('pending');
      else if (incoming.some((c) => c.id === id)) setStatus('incoming');
      else setStatus('none');
      const chat = chats.find((c) => c.otherId === id);
      setChatId(chat?.id ?? null);
    } catch (err: any) {
      setError(err?.message ?? 'Not found');
    }
  }
  useEffect(() => { load(); }, [id]);

  async function connect() { await api(`/connections/request/${id}`, { method: 'POST' }); await load(); }
  async function accept() { await api(`/connections/${id}/accept`, { method: 'POST' }); await load(); }
  async function decline() { await api(`/connections/${id}/decline`, { method: 'POST' }); await load(); }
  async function disconnect() {
    if (!confirm('Disconnect from this user?')) return;
    await api(`/connections/${id}`, { method: 'DELETE' }); await load();
  }

  if (error) return <div className="container"><h1>Profile</h1><p>{error}</p></div>;
  if (!user || !profile || !bio) return <div className="container">Loading...</div>;

  const online = presence[user.id] ?? pres?.online ?? false;

  return (
    <div className="container">
      <div className="card">
        <div className="row">
          <Avatar url={user.avatarUrl} size={96} />
          <div>
            <h1 style={{ margin: 0 }}>{user.displayName}</h1>
            <p>
              <span className={online ? 'online-dot' : 'offline-dot'}></span>
              {online ? 'online' : `last seen ${pres ? new Date(pres.lastSeenAt).toLocaleString() : '—'}`}
            </p>
            <p className="muted">
              {[profile.age, profile.gender, profile.city].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        <div className="row" style={{ marginTop: '1rem' }}>
          {status === 'none' && <button onClick={connect}>Connect</button>}
          {status === 'pending' && <span className="pill">Request sent</span>}
          {status === 'incoming' && <>
            <button onClick={accept}>Accept</button>
            <button onClick={decline}>Decline</button>
          </>}
          {status === 'connected' && <>
            <span className="pill">Connected</span>
            {chatId && <button onClick={() => nav(`/chats/${chatId}`)}>Open chat</button>}
            <button onClick={disconnect}>Disconnect</button>
          </>}
        </div>
      </div>

      {profile.aboutMe && (
        <div className="card">
          <h2>About</h2>
          <p>{profile.aboutMe}</p>
        </div>
      )}

      <div className="card">
        <h2>Gym & training</h2>
        <p><b>Gym:</b> {bio.gymName ?? '—'}</p>
        <p><b>Level:</b> {bio.experienceLevel ?? '—'} · <b>Intensity:</b> {bio.intensity ?? '—'}</p>
        <p><b>Workout types:</b> {bio.workoutTypes.map((w) => <span key={w} className="pill">{w}</span>)}</p>
        <p><b>Goals:</b> {bio.goals.map((w) => <span key={w} className="pill">{w}</span>)}</p>
        <p><b>Looking for:</b> {bio.lookingFor.map((w) => <span key={w} className="pill">{w}</span>)}</p>
        <p><b>Schedule:</b> {bio.scheduleSlots.map((w) => <span key={w} className="pill">{w}</span>)}</p>
      </div>

      <p><Link to="/recommendations">← Back</Link></p>
    </div>
  );
}
