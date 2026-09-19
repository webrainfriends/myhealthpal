-- Conversational health assistant (issue #10).

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system_notice')),
  content TEXT NOT NULL,
  -- Structured evidence IDs backing an assistant answer, e.g.
  -- [{"type": "measurement", "id": "...", "label": "..."}]. Empty for
  -- messages that cite nothing (small talk, safety notices, user turns).
  evidence JSONB NOT NULL DEFAULT '[]',
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);

-- Non-sensitive observability only: never raw prompts/answers/health values.
CREATE TABLE IF NOT EXISTS chat_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('turn', 'tool_call', 'safety_intercept', 'error')),
  tool_name TEXT,
  provider TEXT,
  model TEXT,
  latency_ms INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  success BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_events_session_id ON chat_events(session_id);
