-- 0007 — flag the "nothing pending" next step, and close out the next step when
-- an application reaches a terminal status.
--
-- A closed application has nothing pending: once the status is terminal the
-- next step becomes the "None" option and next_step_date_time is cleared, so a
-- rejected application cannot leave a phantom interview on the calendar or a
-- date sitting beside "None" in the list.
--
-- Which option means "nothing pending" has to be a flag rather than the label
-- 'None' (CLAUDE.md rule 3) — the owner may relabel it at any time. Sibling to
-- status.is_terminal / is_interview / is_offer, and for the same reason.

ALTER TABLE next_step ADD COLUMN is_none INTEGER NOT NULL DEFAULT 0
  CHECK (is_none IN (0, 1));

UPDATE next_step SET is_none = 1 WHERE label = 'None';

-- Bring existing rows in line with the rule. A no-op on the owner's database
-- today — every terminal row already reads "None" with no date — but a
-- migration cannot assume the database it lands on. The last predicate skips
-- rows that already conform so their updated_at is left alone.
UPDATE application
   SET next_step_id = (SELECT id FROM next_step WHERE is_none = 1),
       next_step_date_time = NULL
 WHERE EXISTS (SELECT 1 FROM next_step WHERE is_none = 1)
   AND (SELECT is_terminal FROM status WHERE id = status_id) = 1
   AND (next_step_id <> (SELECT id FROM next_step WHERE is_none = 1)
        OR next_step_date_time IS NOT NULL);
