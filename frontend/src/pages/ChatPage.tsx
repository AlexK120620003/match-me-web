import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import Avatar from '../components/Avatar';
import type { Message, UserSummary } from '../api/types';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

const PAGE_SIZE = 30;

export default function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const { userId } = useAuth();
  const { socket, presence } = useSocket();

  const [other, setOther] = useState<UserSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]); // sorted ASC by created_at
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingStartedRef = useRef(false);

  // Initial load: get chat info + latest page
  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    (async () => {
      const chats = await api<{ id: string; otherId: string }[]>('/chats');
      const chat = chats.find((c) => c.id === chatId);
      if (!chat) return;
      if (cancelled) return;
      const u = await api<UserSummary>(`/users/${chat.otherId}`);
      if (cancelled) return;
      setOther(u);

      const latest = await api<Message[]>(`/chats/${chatId}/messages?limit=${PAGE_SIZE}`);
      if (cancelled) return;
      // latest is DESC — reverse to ASC for display
      const asc = [...latest].reverse();
      setMessages(asc);
      setHasMore(latest.length === PAGE_SIZE);

      // Mark as read
      await api(`/chats/${chatId}/read`, { method: 'POST' });

      // Scroll to bottom
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    })();
    return () => { cancelled = true; };
  }, [chatId]);

  // Socket: incoming messages / typing / read receipts
  useEffect(() => {
    if (!socket || !chatId) return;

    const onNew = (m: Message) => {
      if (m.chat_id !== chatId) return;
      setMessages((prev) => [...prev, m]);
      // If message is from the other user and we're viewing → immediately mark as read.
      if (m.sender_id !== userId) {
        api(`/chats/${chatId}/read`, { method: 'POST' }).catch(() => {});
      }
      // Auto-scroll if near bottom
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
        if (nearBottom) el.scrollTop = el.scrollHeight;
      });
    };

    const onTypingStart = ({ chatId: cid }: { chatId: string; fromId: string }) => {
      if (cid !== chatId) return;
      setTyping(true);
    };
    const onTypingStop = ({ chatId: cid }: { chatId: string; fromId: string }) => {
      if (cid !== chatId) return;
      setTyping(false);
    };
    const onRead = ({ chatId: cid }: { chatId: string }) => {
      if (cid !== chatId) return;
      setMessages((prev) => prev.map((m) => (m.read_at ? m : { ...m, read_at: new Date().toISOString() })));
    };

    socket.on('message:new', onNew);
    socket.on('typing:start', onTypingStart);
    socket.on('typing:stop', onTypingStop);
    socket.on('message:read', onRead);
    return () => {
      socket.off('message:new', onNew);
      socket.off('typing:start', onTypingStart);
      socket.off('typing:stop', onTypingStop);
      socket.off('message:read', onRead);
    };
  }, [socket, chatId, userId]);

  async function loadOlder() {
    if (!chatId || !hasMore || messages.length === 0 || loadingMore) return;
    setLoadingMore(true);
    const oldest = messages[0];
    try {
      const older = await api<Message[]>(`/chats/${chatId}/messages?limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest.created_at)}`);
      const asc = [...older].reverse();
      setMessages((prev) => [...asc, ...prev]);
      if (older.length < PAGE_SIZE) setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }

  function onDraftChange(v: string) {
    setDraft(v);
    if (!socket || !chatId) return;
    if (!typingStartedRef.current && v.length > 0) {
      typingStartedRef.current = true;
      socket.emit('typing:start', { chatId });
    }
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      typingStartedRef.current = false;
      socket.emit('typing:stop', { chatId });
    }, 2000);
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!chatId || !draft.trim()) return;
    const body = draft.trim();
    setDraft('');
    // Stop typing
    if (socket && typingStartedRef.current) {
      typingStartedRef.current = false;
      socket.emit('typing:stop', { chatId });
    }
    // Send via REST; server broadcasts via socket, so our UI will update through onNew.
    await api<Message>(`/chats/${chatId}/messages`, { method: 'POST', json: { body } });
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 80) loadOlder();
  }

  if (!other) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <div className="card row">
        <Avatar url={other.avatarUrl} />
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>{other.displayName}</h2>
          <div className="muted">
            <span className={presence[other.id] ? 'online-dot' : 'offline-dot'}></span>
            {presence[other.id] ? 'online' : 'offline'}
          </div>
        </div>
        <Link to="/chats">← Chats</Link>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          height: '55vh',
          overflowY: 'auto',
          background: '#fff',
          border: '1px solid #ddd',
          borderRadius: 6,
          padding: '.5rem',
        }}
      >
        {hasMore && <div className="muted" style={{ textAlign: 'center' }}>{loadingMore ? 'Loading...' : '(scroll up for older)'}</div>}
        {messages.map((m) => {
          const mine = m.sender_id === userId;
          return (
            <div key={m.id} style={{
              display: 'flex',
              justifyContent: mine ? 'flex-end' : 'flex-start',
              margin: '4px 0',
            }}>
              <div style={{
                maxWidth: '70%',
                background: mine ? '#dff' : '#eef',
                padding: '6px 10px',
                borderRadius: 8,
              }}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                <div className="muted" style={{ fontSize: '.75em', textAlign: mine ? 'right' : 'left' }}>
                  {new Date(m.created_at).toLocaleString()}
                  {mine && m.read_at && <> · read</>}
                </div>
              </div>
            </div>
          );
        })}
        {typing && <div className="muted">💬 {other.displayName} is typing...</div>}
      </div>

      <form onSubmit={onSend} className="row" style={{ marginTop: '.5rem' }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Type a message..."
          maxLength={2000}
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={!draft.trim()}>Send</button>
      </form>
    </div>
  );
}
