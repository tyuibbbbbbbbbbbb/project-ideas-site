const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'app.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ideas (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  author      TEXT DEFAULT 'אנונימי',
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category    TEXT DEFAULT 'אחר',
  image_url   TEXT,
  progress    TEXT DEFAULT 'open' CHECK(progress IN ('open','taken','done','abandoned')),
  taken_by    TEXT,
  taken_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  forum_link  TEXT,
  likes       INTEGER DEFAULT 0,
  dislikes    INTEGER DEFAULT 0,
  nice        INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'active' CHECK(status IN ('active','review')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS votes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id   TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voter_key TEXT NOT NULL,
  vote_type TEXT NOT NULL CHECK(vote_type IN ('like','dislike','nice')),
  UNIQUE(voter_key, idea_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  likes      INTEGER DEFAULT 0,
  dislikes   INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS progress_reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  likes      INTEGER DEFAULT 0,
  dislikes   INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comment_votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voter_key   TEXT NOT NULL,
  vote_type   TEXT NOT NULL CHECK(vote_type IN ('like','dislike')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(comment_id, voter_key)
);

CREATE TABLE IF NOT EXISTS report_votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id   INTEGER NOT NULL REFERENCES progress_reports(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voter_key   TEXT NOT NULL,
  vote_type   TEXT NOT NULL CHECK(vote_type IN ('like','dislike')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(report_id, voter_key)
);

CREATE TABLE IF NOT EXISTS admin_flags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id     TEXT REFERENCES ideas(id) ON DELETE CASCADE,
  comment_id  INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  report_id   INTEGER REFERENCES progress_reports(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// ── Helpers ─────────────────────────────────────────────
function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

module.exports = { db, hashPassword, verifyPassword };
