-- 0003 — give each status a display tone.
--
-- The UI previously picked a tag colour by pattern-matching the label
-- (/^Interview/, /^Offer/), which CLAUDE.md forbids: relabel a status and its
-- colour changes silently, and a new status falls through to the default.
--
-- Tone is a property of the status, so it belongs on the row. Editing this
-- vocabulary stays a hand-edit + migration, like the labels themselves.
--
--   quiet     open but passive — waiting on them
--   active    in motion — something is scheduled or under way
--   positive  the good outcome
--   closed    ended, no further action
--
-- Note "Offer accepted" is both terminal and positive, which is why tone cannot
-- be derived from is_terminal.

ALTER TABLE status ADD COLUMN tone TEXT NOT NULL DEFAULT 'quiet'
  CHECK (tone IN ('quiet', 'active', 'positive', 'closed'));

UPDATE status SET tone = 'active'   WHERE label IN (
  'Interview scheduled',
  'Interviewed (round 1)',
  'Interviewed (round 2)',
  'Interviewed (round 3)',
  'Interviewed (round 4)'
);

UPDATE status SET tone = 'positive' WHERE label IN ('Offer received', 'Offer accepted');

UPDATE status SET tone = 'closed'   WHERE label IN (
  'Offer declined',
  'Rejected',
  'Expired / Not pursued'
);
