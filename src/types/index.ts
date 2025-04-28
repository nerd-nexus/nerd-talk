export interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
  created_at: string;
}

export interface Message {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  username?: string;
  profile?: Profile;
}