import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import Avatar from '../components/Avatar';
import type { UserSummary, ChatSummary } from '../api/types';
import { useSocket } from '../contexts/SocketContext';

interface Row { user: UserSummary; }

export default function ConnectionsPage() {
  const [incoming, setIncoming] = useState<Row[]>([]);
  const [connected, setConnected] = useState<Row[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const { presence } = useSocket();
  const nav = useNavigate();

  async function load() {
    const [reqIds, connIds, chatsList] = await Promise.all([
      api<{ id: string }[]>('/connections/requests'),
      api<{ id: string }[]>('/connections'),
      api<ChatSummary[]>('/chats'),
    ]);
    const [reqs, conns] = await Promise.all([
      Promise.all(reqIds.map(({ id }) => api<UserSummary>(`/users/${id}`).then((user) => ({ user })))),
      Promise.all(connIds.map(({ id }) => api<UserSummary>(`/users/${id}`).then((user) => ({ user })))),
    ]);
    setIncoming(reqs);
    setConnected(conns);
    setChats(chatsList);
  }
  useEffect(() => { load(); }, []);

  async function accept(id: string) { await api(`/connections/${id}/accept`, { method: 'POST' }); await load(); }
  async function decline(id: string) { await api(`/connections/${id}/decline`, { method: 'POST' }); await load(); }
  async function disconnect(id: string) {
    if (!confirm('Disconnect?')) return;
    await api(`/connections/${id}`, { method: 'DELETE' }); await load();
  }
  function openChat(id: string) {
    const chat = chats.find((c) => c.otherId === id);
    if (chat) nav(`/chats/${chat.id}`);
  }

  return (
    <div className="container">
      <h1>Connections</h1>
      <h2>Incoming requests ({incoming.length})</h2>
      {incoming.length === 0 && <p className="muted">No pending requests.</p>}
      {incoming.map(({ user }) => (
        <div className="card row" key={user.id}>
          <Avatar url={user.avatarUrl} />
          <Link to={`/users/${user.id}`} style={{ flex: 1 }}>{user.displayName}</Link>
          <button onClick={() => accept(user.id)}>Accept</button>
          <button onClick={() => decline(user.id)}>Decline</button>
        </div>
      ))}

      <h2>Connected ({connected.length})</h2>
      {connected.length === 0 && <p className="muted">No connections yet. Go make some!</p>}
      {connected.map(({ user }) => (
        <div className="card row" key={user.id}>
          <Avatar url={user.avatarUrl} />
          <div style={{ flex: 1 }}>
            <Link to={`/users/${user.id}`}>{user.displayName}</Link>
            <div className="muted">
              <span className={presence[user.id] ? 'online-dot' : 'offline-dot'}></span>
              {presence[user.id] ? 'online' : 'offline'}
            </div>
          </div>
          <button onClick={() => openChat(user.id)}>Chat</button>
          <button onClick={() => disconnect(user.id)}>Disconnect</button>
        </div>
      ))}
    </div>
  );
}
