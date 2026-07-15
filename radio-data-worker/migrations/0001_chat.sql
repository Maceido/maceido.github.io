CREATE TABLE IF NOT EXISTS chat_users (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  display_name TEXT NOT NULL,
  type TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx
  ON chat_messages (created_at);

CREATE INDEX IF NOT EXISTS chat_messages_user_id_idx
  ON chat_messages (user_id, created_at);
