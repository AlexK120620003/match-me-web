import { Router } from 'express';
import { register, login, logout } from '../controllers/auth';
import {
  getUser,
  getUserProfile,
  getUserBio,
  getMyEmail,
} from '../controllers/users';
import {
  updateMe,
  updateMyProfile,
  updateMyBio,
  uploadAvatar,
  deleteAvatar,
} from '../controllers/me';
import {
  listRecommendations,
  dismissRecommendation,
} from '../controllers/recommendations';
import {
  requestConnection,
  acceptConnection,
  declineConnection,
  disconnect,
  listConnections,
  listIncomingRequests,
  listOutgoingRequests,
} from '../controllers/connections';
import {
  listChats,
  getMessages,
  sendMessage,
  markRead,
  unreadCount,
} from '../controllers/chats';
import { getPresence } from '../controllers/presence';
import { requireAuth } from '../middleware/auth';
import { avatarUpload } from '../middleware/upload';

export const router = Router();

// --- Public ---
router.post('/auth/register', register);
router.post('/auth/login', login);
router.post('/auth/logout', logout);

// --- Authenticated ---
router.use(requireAuth);

// Me shortcuts (must come before /users/:id so they don't collide — not actually needed since :id is a param,
// but we implement them as dedicated handlers to keep semantics clear).
router.get('/me', getUser);
router.get('/me/profile', getUserProfile);
router.get('/me/bio', getUserBio);
router.get('/me/email', getMyEmail);

router.put('/me', updateMe);
router.put('/me/profile', updateMyProfile);
router.put('/me/bio', updateMyBio);
router.post('/me/avatar', avatarUpload.single('avatar'), uploadAvatar);
router.delete('/me/avatar', deleteAvatar);

// Users (requires visibility)
router.get('/users/:id', getUser);
router.get('/users/:id/profile', getUserProfile);
router.get('/users/:id/bio', getUserBio);
router.get('/users/:id/presence', getPresence);

// Recommendations
router.get('/recommendations', listRecommendations);
router.post('/recommendations/:id/dismiss', dismissRecommendation);

// Connections
router.get('/connections', listConnections);
router.get('/connections/requests', listIncomingRequests);
router.get('/connections/outgoing', listOutgoingRequests);
router.post('/connections/request/:id', requestConnection);
router.post('/connections/:id/accept', acceptConnection);
router.post('/connections/:id/decline', declineConnection);
router.delete('/connections/:id', disconnect);

// Chats
router.get('/chats', listChats);
router.get('/chats/unread-count', unreadCount);
router.get('/chats/:chatId/messages', getMessages);
router.post('/chats/:chatId/messages', sendMessage);
router.post('/chats/:chatId/read', markRead);
