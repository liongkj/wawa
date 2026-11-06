CREATE TABLE signups (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'ms')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
