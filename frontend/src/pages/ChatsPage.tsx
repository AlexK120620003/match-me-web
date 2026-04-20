import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import Avatar from '../components/Avatar';
import type { ChatSummary, UserSummary } from '../api/types';
import { useSocket } from '../contexts/SocketContext';

interface Row { chat: ChatSummary; other: UserSummary; }

export default function ChatsPage() {
  const { socket, presence } = useSocket();
  const [rows, setRows] = useState<Row[]>([]);

  async function load() {
    const chats = await api<ChatSummary[]>('/chats');
    const withUsers = await Promise.all(
      chats.map(async (c) => ({ chat: c, other: await api<UserSummary>(`/users/${c.otherId}`) }))
    );
    setRows(withUsers);
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!socket) return;
    const onAny = () => load();
    socket.on('message:new', onAny);
    socket.on('message:read', onAny);
    return () => {
      socket.off('message:new', onAny);
      socket.off('message:read', onAny);
    };
  }, [socket]);

  return (
    <div className="container">
      <h1>Chats</h1>
      {rows.length === 0 && <p className="muted">No chats yet. Connect with someone first.</p>}
      {rows.map(({ chat, other }) => (
        <Link to={`/chats/${chat.id}`} key={chat.id} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="card row">
            <Avatar url={other.avatarUrl} />
            <div style={{ flex: 1 }}>
              <div className="row">
                <b>{other.displayName}</b>
                <span className={presence[other.id] ? 'online-dot' : 'offline-dot'}></span>
              </div>
              <div className="muted" style={{ fontSize: '.9em' }}>
                {chat.lastMessage
                  ? `${chat.lastMessage.senderId === other.id ? '' : 'You: '}${chat.lastMessage.body}`
                  : 'No messages yet'}
              </div>
            </div>
            {chat.unreadCount > 0 && <span className="badge">{chat.unreadCount}</span>}
            {chat.lastMessage && (
              <div className="muted" style={{ fontSize: '.8em' }}>
                {new Date(chat.lastMessage.createdAt).toLocaleString()}
              </div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
