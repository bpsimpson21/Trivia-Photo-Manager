export interface Session {
  id: string;
  name: string;
  date: string;
  created_at: string;
  games?: Game[];
}

export interface Game {
  id: string;
  session_id: string;
  name: string;
  position: number;
  created_at: string;
  photos?: Photo[];
  photo_count?: number;
  first_photo_url?: string;
}

export interface Photo {
  id: string;
  game_id: string;
  storage_path: string;
  public_url: string;
  position: number;
  answer_text: string | null;
  answer_image_path: string | null;
  answer_image_url: string | null;
  created_at: string;
}

export interface DisplayState {
  id: string;
  session_id: string;
  current_game_id: string | null;
  current_photo_index: number;
  show_answer: boolean;
  is_playing: boolean;
  timer_seconds: number;
  updated_at: string;
}
