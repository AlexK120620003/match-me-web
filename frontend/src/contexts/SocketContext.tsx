import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { getToken } from '../api/client';
import { useAuth } from './AuthContext';

interface SocketState {
  socket: Socket | null;
  /** Map userId -> online boolean */
  presence: Record<string, boolean>;
}

const SocketContext = createContext<SocketState | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [presence, setPresence] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!userId) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }
    const token = getToken();
    if (!token) return;

    const s = io('/', { auth: { token }, transports: ['websocket', 'polling'] });

    s.on('presence:update', ({ userId, online }: { userId: string; online: boolean }) => {
      setPresence((prev) => ({ ...prev, [userId]: online }));
    });

    setSocket(s);
    return () => {
      s.disconnect();
    };

  }, [userId]);

  return (
    <SocketContext.Provider value={{ socket, presence }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): SocketState {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
}
