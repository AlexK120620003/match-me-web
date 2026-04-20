import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { api } from '../api/client';

export default function NavBar() {
  const { logout } = useAuth();
  const { socket } = useSocket();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  async function refresh() {
    try {
      const u = await api<{ count: number }>('/chats/unread-count');
      setUnread(u.count);
      const reqs = await api<any[]>('/connections/requests');
      setPendingCount(reqs.length);
    } catch { /* ignore */ }
  }

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!socket) return;
    const onNew = () => refresh();
    const onRead = () => refresh();
    socket.on('message:new', onNew);
    socket.on('message:read', onRead);
    return () => {
      socket.off('message:new', onNew);
      socket.off('message:read', onRead);
    };
  }, [socket]);

  function onLogout() {
    logout();
    navigate('/login');
  }

  return (
    <nav>
      <NavLink to="/recommendations">Recommendations</NavLink>
      <NavLink to="/connections">Connections{pendingCount > 0 && <> <span className="badge">{pendingCount}</span></>}</NavLink>
      <NavLink to="/chats">Chats{unread > 0 && <> <span className="badge">{unread}</span></>}</NavLink>
      <NavLink to="/me">My profile</NavLink>
      <button onClick={onLogout}>Log out</button>
    </nav>
  );
}
