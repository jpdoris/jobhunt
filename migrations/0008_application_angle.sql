-- 0008 — record the angle an application was pitched from.
--
-- "Angle" is which version of the owner's story went out — "Senior Vue
-- frontend", "Design systems / UX engineer" — so résumé and cover-letter
-- choices can be compared across applications. Short free text, not a
-- vocabulary: angles are invented per posting and rarely repeat exactly.
--
-- It is searchable alongside notes, so the FTS table is rebuilt with the extra
-- column. application_fts is external-content (content = 'application'), so
-- 'rebuild' repopulates it from the table and nothing is lost.

ALTER TABLE application ADD COLUMN angle TEXT;

DROP TRIGGER application_fts_insert;
DROP TRIGGER application_fts_delete;
DROP TRIGGER application_fts_update;
DROP TABLE application_fts;

CREATE VIRTUAL TABLE application_fts USING fts5(
  company, role, description, notes, angle,
  content = 'application',
  content_rowid = 'id',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER application_fts_insert AFTER INSERT ON application
BEGIN
  INSERT INTO application_fts(rowid, company, role, description, notes, angle)
  VALUES (NEW.id, NEW.company, NEW.role, NEW.description, NEW.notes, NEW.angle);
END;

CREATE TRIGGER application_fts_delete AFTER DELETE ON application
BEGIN
  INSERT INTO application_fts(application_fts, rowid, company, role, description, notes, angle)
  VALUES ('delete', OLD.id, OLD.company, OLD.role, OLD.description, OLD.notes, OLD.angle);
END;

CREATE TRIGGER application_fts_update AFTER UPDATE ON application
BEGIN
  INSERT INTO application_fts(application_fts, rowid, company, role, description, notes, angle)
  VALUES ('delete', OLD.id, OLD.company, OLD.role, OLD.description, OLD.notes, OLD.angle);
  INSERT INTO application_fts(rowid, company, role, description, notes, angle)
  VALUES (NEW.id, NEW.company, NEW.role, NEW.description, NEW.notes, NEW.angle);
END;

INSERT INTO application_fts(application_fts) VALUES ('rebuild');
