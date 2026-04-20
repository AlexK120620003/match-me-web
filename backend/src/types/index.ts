// Shared domain types for the backend.

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  avatar_url: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface ProfileRow {
  user_id: string;
  about_me: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  is_complete: boolean;
  created_at: string;
  updated_at: string;
}

export interface BioRow {
  user_id: string;
  workout_types: string[];
  experience_level: string | null;
  schedule_slots: string[];
  goals: string[];
  looking_for: string[];
  gym_name: string | null;
  intensity: string | null;
  created_at: string;
  updated_at: string;
}

export type ConnectionStatus = 'pending' | 'accepted' | 'declined';

export interface ConnectionRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

export interface ChatRow {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

// Express Request augmentation
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
