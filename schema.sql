CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT 'Пользователь',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT 'Пользователь';
CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT, experience TEXT, skills TEXT, education TEXT, age TEXT, region TEXT,
  work_format TEXT, desired_salary TEXT, learning_time TEXT, goal_horizon TEXT,
  management_interest TEXT, memory_version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dialogues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Новый диалог', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY, dialogue_id UUID NOT NULL REFERENCES dialogues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('user', 'assistant', 'system')), body TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE OR REPLACE FUNCTION ensure_message_metadata() RETURNS trigger AS $$
BEGIN
  IF NEW.sender = 'assistant' AND NEW.metadata = '{}'::jsonb THEN
    NEW.metadata = jsonb_build_object('rationale', 'Ответ сформирован с учётом сообщения пользователя, сохранённого профиля и истории диалога.');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_message_metadata ON messages;
CREATE TRIGGER trg_message_metadata BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION ensure_message_metadata();
CREATE TABLE IF NOT EXISTS career_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dialogue_id UUID REFERENCES dialogues(id) ON DELETE SET NULL, version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'outdated', 'failed')),
  selected_track INTEGER, plan_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES career_plans(id) ON DELETE SET NULL, stage TEXT NOT NULL CHECK (stage IN ('analyst', 'generator', 'critic', 'improver')),
  prompt_version TEXT NOT NULL, context_version INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error_code TEXT, token_usage JSONB, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS memory_facts (
  id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, field_name TEXT NOT NULL, value TEXT NOT NULL,
  source_message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(user_id, field_name)
);
CREATE TABLE IF NOT EXISTS resume_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, extracted_text TEXT NOT NULL,
  extracted_json JSONB, extraction_source TEXT NOT NULL DEFAULT 'local', status TEXT NOT NULL DEFAULT 'ready',
  error_code TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dialogues_user ON dialogues(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_dialogue ON messages(dialogue_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plans_user ON career_plans(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id, started_at DESC);
