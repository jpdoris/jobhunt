-- 0002 — consolidate "Job listing closed" and "Closed / Not pursued".
--
-- Both meant the same thing in practice: the application ended without a
-- decision, either because the posting was pulled or because it was not
-- pursued. They are merged into a single 'Expired / Not pursued'.
--
-- The surviving row is the one at sort_order 120, relabelled in place, so its
-- id stays stable and a migrated database ends up with the same status ids as
-- one built fresh from 0001 + 0002.

-- Reassigning applications would fire application_status_event_update and write
-- a history row dated today, implying the status changed now. It did not — only
-- the vocabulary did. Suspend the trigger for the reassignment.
DROP TRIGGER application_status_event_update;

UPDATE application
   SET status_id = (SELECT id FROM status WHERE label = 'Job listing closed')
 WHERE status_id = (SELECT id FROM status WHERE label = 'Closed / Not pursued');

-- Existing history keeps pointing at a real status rather than a deleted id.
UPDATE status_event
   SET status_id = (SELECT id FROM status WHERE label = 'Job listing closed')
 WHERE status_id = (SELECT id FROM status WHERE label = 'Closed / Not pursued');

-- Safe to delete now that nothing references it; the FK would refuse otherwise.
DELETE FROM status WHERE label = 'Closed / Not pursued';

UPDATE status
   SET label = 'Expired / Not pursued'
 WHERE label = 'Job listing closed';

-- Restored exactly as defined in docs/schema.sql — tests/schema-drift.test.ts
-- compares trigger SQL text, so any difference here is a failure.
CREATE TRIGGER application_status_event_update AFTER UPDATE OF status_id ON application
WHEN OLD.status_id IS NOT NEW.status_id
BEGIN
  INSERT INTO status_event(application_id, status_id) VALUES (NEW.id, NEW.status_id);
END;
