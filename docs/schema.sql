-- Job Hunting Dashboard — canonical SQLite schema.
-- Dates are stored as ISO-8601 'YYYY-MM-DD' text; timestamps as UTC 'YYYY-MM-DD HH:MM:SS'.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------------------
-- Users
--
-- Single user today. user_id exists on application from day one so opening the
-- app up later is additive rather than a migration across every query.
-- ---------------------------------------------------------------------------

CREATE TABLE user (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Lookup tables
--
-- These vocabularies are FIXED. The app reads them and never writes them: there
-- is no UI, endpoint, or script that inserts, updates, or deletes a row here.
-- The owner edits this file by hand and re-runs the migration.
--
-- Never DELETE a row that applications point at (the FK will refuse); set
-- is_active = 0 to retire it instead, which hides it from pickers while
-- existing rows keep rendering correctly.
-- ---------------------------------------------------------------------------

CREATE TABLE status (
  id          INTEGER PRIMARY KEY,
  label       TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL,
  is_terminal INTEGER NOT NULL DEFAULT 0 CHECK (is_terminal IN (0, 1)),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  -- Drives the tag colour. A property of the status, so the UI never has to
  -- pattern-match a label. "Offer accepted" is both terminal and positive,
  -- which is why this cannot be derived from is_terminal.
  --   quiet | active | positive | closed
  tone        TEXT NOT NULL DEFAULT 'quiet'
    CHECK (tone IN ('quiet', 'active', 'positive', 'closed')),
  -- Added by migration 0005, hence last: ALTER TABLE ADD COLUMN appends.
  -- Whether reaching this status means an interview actually happened.
  -- Excludes 'Interview scheduled' — booked is not completed. Cannot be
  -- derived from tone or sort_order, so it is its own flag.
  is_interview INTEGER NOT NULL DEFAULT 0 CHECK (is_interview IN (0, 1)),
  -- Added by migration 0006, hence last. Whether an offer was actually made.
  -- 'Offer declined' counts — you can only decline one you were given — which
  -- is why "closed without an offer" cannot be derived from is_terminal.
  is_offer INTEGER NOT NULL DEFAULT 0 CHECK (is_offer IN (0, 1))
);

CREATE TABLE next_step (
  id         INTEGER PRIMARY KEY,
  label      TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

CREATE TABLE application (
  id               INTEGER PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,

  company          TEXT NOT NULL,
  role             TEXT,                        -- 4 seed rows have no role
  description      TEXT,                        -- pasted JD prose, up to ~6k chars
  job_posting_link TEXT,
  contact          TEXT,                        -- recruiter email

  apply_date       TEXT CHECK (apply_date IS NULL OR apply_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

  status_id        INTEGER NOT NULL REFERENCES status(id),
  next_step_id     INTEGER NOT NULL REFERENCES next_step(id),
  -- When the next step happens. Interpreted against whatever next_step says,
  -- so it is the screener slot, the round-2 slot, the follow-up reminder, etc.
  --
  -- UTC instant, 'YYYY-MM-DD HH:MM:SS' — NOT a floating date like apply_date.
  -- An interview is a moment in time, so it converts to the viewer's zone.
  -- GLOB alone would pass hour 25, so the hour is range-checked separately.
  next_step_date_time TEXT CHECK (
    next_step_date_time IS NULL OR (
      next_step_date_time GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-2][0-9]:[0-5][0-9]:[0-5][0-9]'
      AND CAST(substr(next_step_date_time, 12, 2) AS INTEGER) < 24
    )
  ),

  notes            TEXT,
  -- Filed with unemployment as proof of search. Nothing to do with the UI.
  submitted_to_unemployment INTEGER NOT NULL DEFAULT 0
    CHECK (submitted_to_unemployment IN (0, 1)),

  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),

  -- Added by migration 0004, hence last: ALTER TABLE ADD COLUMN appends.
  -- When the current status began. Also carries the intended timestamp into the
  -- status_event triggers, so a status change can be recorded as having happened
  -- in the past rather than "now".
  status_changed_at TEXT CHECK (
    status_changed_at IS NULL OR (
      status_changed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-2][0-9]:[0-5][0-9]:[0-5][0-9]'
      AND CAST(substr(status_changed_at, 12, 2) AS INTEGER) < 24
    )
  )
);

CREATE INDEX application_user_idx           ON application(user_id);
CREATE INDEX application_status_idx         ON application(user_id, status_id);
CREATE INDEX application_apply_date_idx     ON application(user_id, apply_date DESC);
CREATE INDEX application_next_step_idx      ON application(user_id, next_step_date_time)
  WHERE next_step_date_time IS NOT NULL;   -- drives the calendar and reminders

CREATE TRIGGER application_touch AFTER UPDATE ON application
BEGIN
  UPDATE application SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------------
-- Full-text search
--
-- Descriptions run to ~6k characters, so LIKE '%…%' scans get expensive.
-- Contentless FTS5 index kept in sync by triggers; query it, then join back.
-- ---------------------------------------------------------------------------

CREATE VIRTUAL TABLE application_fts USING fts5(
  company, role, description, notes,
  content = 'application',
  content_rowid = 'id',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER application_fts_insert AFTER INSERT ON application
BEGIN
  INSERT INTO application_fts(rowid, company, role, description, notes)
  VALUES (NEW.id, NEW.company, NEW.role, NEW.description, NEW.notes);
END;

CREATE TRIGGER application_fts_delete AFTER DELETE ON application
BEGIN
  INSERT INTO application_fts(application_fts, rowid, company, role, description, notes)
  VALUES ('delete', OLD.id, OLD.company, OLD.role, OLD.description, OLD.notes);
END;

CREATE TRIGGER application_fts_update AFTER UPDATE ON application
BEGIN
  INSERT INTO application_fts(application_fts, rowid, company, role, description, notes)
  VALUES ('delete', OLD.id, OLD.company, OLD.role, OLD.description, OLD.notes);
  INSERT INTO application_fts(rowid, company, role, description, notes)
  VALUES (NEW.id, NEW.company, NEW.role, NEW.description, NEW.notes);
END;

-- ---------------------------------------------------------------------------
-- Status history
--
-- Every status change is appended here. This is the ONLY source of timing data:
-- application.status_id is the current state and says nothing about when it was
-- reached, so time-to-response, time-to-rejection, and stage durations are all
-- computed from this table.
--
-- Maintained entirely by triggers so application code cannot forget to record a
-- transition. Never INSERT into it directly.
-- ---------------------------------------------------------------------------

CREATE TABLE status_event (
  id             INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  status_id      INTEGER NOT NULL REFERENCES status(id),
  changed_at     TEXT NOT NULL DEFAULT (datetime('now'))   -- UTC instant
);

CREATE INDEX status_event_application_idx ON status_event(application_id, changed_at);
CREATE INDEX status_event_status_idx      ON status_event(status_id, changed_at);

CREATE TRIGGER application_status_event_insert AFTER INSERT ON application
BEGIN
  INSERT INTO status_event(application_id, status_id, changed_at)
  VALUES (NEW.id, NEW.status_id, COALESCE(NEW.status_changed_at, datetime('now')));
END;

-- The NOT EXISTS guard makes this idempotent. Editing history writes the winning
-- status back to application.status_id; without the guard that write would fire
-- this trigger and duplicate the very event it came from.
CREATE TRIGGER application_status_event_update AFTER UPDATE OF status_id ON application
WHEN OLD.status_id IS NOT NEW.status_id
 AND NOT EXISTS (
   SELECT 1 FROM status_event
    WHERE application_id = NEW.id
      AND status_id = NEW.status_id
      AND changed_at = COALESCE(NEW.status_changed_at, datetime('now'))
 )
BEGIN
  INSERT INTO status_event(application_id, status_id, changed_at)
  VALUES (NEW.id, NEW.status_id, COALESCE(NEW.status_changed_at, datetime('now')));
END;

-- ---------------------------------------------------------------------------
-- Documents — resumes and cover letters
--
-- The file lives on disk under data/documents/; only its path is stored here.
-- content_text is the plain-text body (extracted from the upload, or pasted)
-- and is the only thing search can see — a PDF with no extracted text is
-- storable but not findable.
--
-- Attachment is many-to-many on purpose: one resume version goes out with many
-- applications, and an application may carry both a resume and a cover letter.
-- ---------------------------------------------------------------------------

CREATE TABLE document_kind (
  id         INTEGER PRIMARY KEY,
  label      TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE document (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind_id      INTEGER NOT NULL REFERENCES document_kind(id),
  title        TEXT NOT NULL,
  file_path    TEXT,      -- relative to data/documents/; NULL for text-only entries
  mime_type    TEXT,
  byte_size    INTEGER,
  content_text TEXT,      -- extracted or pasted plain text; what document_fts indexes
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX document_user_idx ON document(user_id, kind_id);

CREATE TABLE application_document (
  application_id INTEGER NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  document_id    INTEGER NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  PRIMARY KEY (application_id, document_id)
);

CREATE INDEX application_document_doc_idx ON application_document(document_id);

CREATE TRIGGER document_touch AFTER UPDATE ON document
BEGIN
  UPDATE document SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE VIRTUAL TABLE document_fts USING fts5(
  title, content_text,
  content = 'document',
  content_rowid = 'id',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER document_fts_insert AFTER INSERT ON document
BEGIN
  INSERT INTO document_fts(rowid, title, content_text)
  VALUES (NEW.id, NEW.title, NEW.content_text);
END;

CREATE TRIGGER document_fts_delete AFTER DELETE ON document
BEGIN
  INSERT INTO document_fts(document_fts, rowid, title, content_text)
  VALUES ('delete', OLD.id, OLD.title, OLD.content_text);
END;

CREATE TRIGGER document_fts_update AFTER UPDATE ON document
BEGIN
  INSERT INTO document_fts(document_fts, rowid, title, content_text)
  VALUES ('delete', OLD.id, OLD.title, OLD.content_text);
  INSERT INTO document_fts(rowid, title, content_text)
  VALUES (NEW.id, NEW.title, NEW.content_text);
END;

-- ---------------------------------------------------------------------------
-- Seed vocabularies
-- ---------------------------------------------------------------------------

INSERT INTO status (label, sort_order, is_terminal, tone, is_interview, is_offer) VALUES
  ('Applied',                                10, 0, 'quiet',    0, 0),
  ('Contacted recruiter',                    20, 0, 'quiet',    0, 0),
  ('Interview scheduled',                    30, 0, 'active',   0, 0),
  ('Interviewed (round 1)',                  40, 0, 'active',   1, 0),
  ('Interviewed (round 2)',                  50, 0, 'active',   1, 0),
  ('Interviewed (round 3)',                  60, 0, 'active',   1, 0),
  ('Interviewed (round 4)',                  70, 0, 'active',   1, 0),
  ('Offer received',                         80, 0, 'positive', 0, 1),
  ('Offer declined',                         90, 1, 'closed',   0, 1),
  ('Offer accepted',                        100, 1, 'positive', 0, 1),
  ('Rejected',                              110, 1, 'closed',   0, 0),
  -- Ended without a decision: posting pulled, or not pursued.
  ('Expired / Not pursued',                 120, 1, 'closed',   0, 0);

INSERT INTO document_kind (label, sort_order) VALUES
  ('Resume',       10),
  ('Cover letter', 20);

INSERT INTO next_step (label, sort_order) VALUES
  ('Awaiting response',  10),
  ('Follow up',          20),
  ('Screener call',      30),
  ('Interview round 1',  40),
  ('Interview round 2',  50),
  ('Interview round 3',  60),
  ('Interview round 4',  70),
  ('None',               80);
