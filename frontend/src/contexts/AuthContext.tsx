import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, getToken, setToken } from '../api/client';

interface AuthState {
  userId: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: if we have a token, verify it via /me.
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<{ id: string }>('/me')
      .then((u) => setUserId(u.id))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const r = await api<{ token: string; userId: string }>('/auth/login', {
      method: 'POST',
      json: { email, password },
    });
    setToken(r.token);
    setUserId(r.userId);
  }

  async function register(email: string, password: string, displayName: string) {
    const r = await api<{ token: string; userId: string }>('/auth/register', {
      method: 'POST',
      json: { email, password, displayName },
    });
    setToken(r.token);
    setUserId(r.userId);
  }

  function logout() {
    setToken(null);
    setUserId(null);
  }

  return (
    <AuthContext.Provider value={{ userId, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
