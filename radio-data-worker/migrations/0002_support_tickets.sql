CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  ticket_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS support_tickets_email_created_idx
  ON support_tickets (email, created_at);

CREATE INDEX IF NOT EXISTS support_tickets_status_created_idx
  ON support_tickets (status, created_at);
