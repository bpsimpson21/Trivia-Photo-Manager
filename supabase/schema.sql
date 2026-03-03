  -- Sessions: a trivia night event
  CREATE TABLE sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Games: a round within a session, ordered
  CREATE TABLE games (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Photos: images within a game, ordered, with optional answer
  CREATE TABLE photos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    public_url TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    answer_text TEXT,
    answer_image_path TEXT,
    answer_image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Display state: real-time sync between TV presentation and phone remote
  CREATE TABLE display_state (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    current_game_id UUID REFERENCES games(id),
    current_photo_index INTEGER DEFAULT 0,
    show_answer BOOLEAN DEFAULT FALSE,
    is_playing BOOLEAN DEFAULT FALSE,
    timer_seconds INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id)
  );

  -- RLS: allow all (single-user app, no auth for v1)
  ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE games ENABLE ROW LEVEL SECURITY;
  ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
  ALTER TABLE display_state ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Allow all on sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all on games" ON games FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all on photos" ON photos FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all on display_state" ON display_state FOR ALL USING (true) WITH CHECK (true);

  -- Enable realtime on display_state for remote control (Phase 3)
  ALTER PUBLICATION supabase_realtime ADD TABLE display_state;
