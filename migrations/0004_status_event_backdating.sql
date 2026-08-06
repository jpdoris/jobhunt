-- 0004 — let a status change record when it actually happened.
--
-- status_event.changed_at previously always came from the column default,
-- datetime('now'), so history could only ever say "when the button was clicked".
-- That makes durations meaningless for anything entered after the fact.
--
-- application.status_changed_at carries the intended timestamp into the trigger,
-- so the trigger remains the only thing that writes status_event (CLAUDE.md
-- rule 7). It doubles as a useful column in its own right: when the current
-- status began, without needing a join.

ALTER TABLE application ADD COLUMN status_changed_at TEXT CHECK (
  status_changed_at IS NULL OR (
    status_changed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-2][0-9]:[0-5][0-9]:[0-5][0-9]'
    AND CAST(substr(status_changed_at, 12, 2) AS INTEGER) < 24
  )
);

-- Seed it from existing history so the column is meaningful immediately.
UPDATE application
   SET status_changed_at = (
     SELECT max(e.changed_at) FROM status_event e WHERE e.application_id = application.id
   )
 WHERE EXISTS (SELECT 1 FROM status_event e WHERE e.application_id = application.id);

DROP TRIGGER application_status_event_insert;
DROP TRIGGER application_status_event_update;

CREATE TRIGGER application_status_event_insert AFTER INSERT ON application
BEGIN
  INSERT INTO status_event(application_id, status_id, changed_at)
  VALUES (NEW.id, NEW.status_id, COALESCE(NEW.status_changed_at, datetime('now')));
END;

-- The NOT EXISTS guard makes the trigger idempotent. Editing history has to
-- write the winning status back to application.status_id; without the guard
-- that write would fire this trigger and duplicate the very event it came from.
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
