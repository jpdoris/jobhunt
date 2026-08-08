-- 0005 — mark which statuses mean an interview actually took place.
--
-- "Did this application reach an interview?" cannot be answered by matching
-- labels (CLAUDE.md rule 3) and cannot be derived from tone or sort_order
-- either: `Interview scheduled` shares the 'active' tone and sits adjacent in
-- the ordering, but a booked interview is not a completed one.
--
-- So it is its own flag, like is_terminal and tone before it.

ALTER TABLE status ADD COLUMN is_interview INTEGER NOT NULL DEFAULT 0
  CHECK (is_interview IN (0, 1));

-- Deliberately excludes 'Interview scheduled' — scheduled is not happened.
UPDATE status SET is_interview = 1 WHERE label IN (
  'Interviewed (round 1)',
  'Interviewed (round 2)',
  'Interviewed (round 3)',
  'Interviewed (round 4)'
);
