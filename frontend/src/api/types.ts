// Types for API responses.

export interface UserSummary {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Profile {
  id: string;
  aboutMe: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  isComplete: boolean;
}

export interface Bio {
  id: string;
  workoutTypes: string[];
  experienceLevel: string | null;
  scheduleSlots: string[];
  goals: string[];
  lookingFor: string[];
  gymName: string | null;
  intensity: string | null;
}

export interface RecommendationId {
  id: string;
}

export interface ConnectionId {
  id: string;
}

export interface IncomingRequest {
  id: string;
  created_at: string;
}

export interface ChatSummary {
  id: string;
  otherId: string;
  lastMessage: { body: string; createdAt: string; senderId: string } | null;
  unreadCount: number;
}

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface Presence {
  online: boolean;
  lastSeenAt: string;
}
