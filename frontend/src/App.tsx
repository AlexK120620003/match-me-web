import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ProfileEditPage from './pages/ProfileEditPage';
import RecommendationsPage from './pages/RecommendationsPage';
import ConnectionsPage from './pages/ConnectionsPage';
import ChatsPage from './pages/ChatsPage';
import ChatPage from './pages/ChatPage';
import UserViewPage from './pages/UserViewPage';
import NavBar from './components/NavBar';

function Protected({ children }: { children: JSX.Element }) {
  const { userId, loading } = useAuth();
  if (loading) return <div className="container">Loading...</div>;
  if (!userId) return <Navigate to="/login" replace />;
  return children;
}

function Guest({ children }: { children: JSX.Element }) {
  const { userId, loading } = useAuth();
  if (loading) return <div className="container">Loading...</div>;
  if (userId) return <Navigate to="/recommendations" replace />;
  return children;
}

export default function App() {
  const { userId } = useAuth();
  return (
    <>
      {userId && <NavBar />}
      <Routes>
        <Route path="/login" element={<Guest><LoginPage /></Guest>} />
        <Route path="/register" element={<Guest><RegisterPage /></Guest>} />

        <Route path="/me" element={<Protected><ProfileEditPage /></Protected>} />
        <Route path="/recommendations" element={<Protected><RecommendationsPage /></Protected>} />
        <Route path="/connections" element={<Protected><ConnectionsPage /></Protected>} />
        <Route path="/chats" element={<Protected><ChatsPage /></Protected>} />
        <Route path="/chats/:chatId" element={<Protected><ChatPage /></Protected>} />
        <Route path="/users/:id" element={<Protected><UserViewPage /></Protected>} />

        <Route path="*" element={<Navigate to={userId ? '/recommendations' : '/login'} replace />} />
      </Routes>
    </>
  );
}
