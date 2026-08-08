-- 0006 — mark which statuses mean an offer was actually made.
--
-- Sibling to is_interview (0005), and needed for the same reason: "closed
-- without an offer" cannot be expressed as is_terminal = 1. `Offer declined`
-- and `Offer accepted` are both terminal and both had an offer, so the flag
-- has to be its own column rather than a label match (CLAUDE.md rule 3).
--
-- `Offer declined` counts: you can only decline an offer you were given.

ALTER TABLE status ADD COLUMN is_offer INTEGER NOT NULL DEFAULT 0
  CHECK (is_offer IN (0, 1));

UPDATE status SET is_offer = 1 WHERE label IN (
  'Offer received',
  'Offer declined',
  'Offer accepted'
);
