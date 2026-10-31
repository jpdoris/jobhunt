-- 0009 — record the posting's requisition id, and make search match prefixes
-- as typed.
--
-- job_req_id is the employer's own id for the posting ("1693", "R-2242"): how a
-- recruiter finds the application, and how a re-posted role is recognised as
-- the same one. Optional free text; formats vary by ATS. Searchable.
--
-- Both FTS tables drop the porter stemmer. Search is a type-as-you-go prefix
-- match, and porter stems the query prefix too: "compsy" became "compsi", which
-- no longer prefixes the indexed "compsych", so a half-typed name found
-- nothing. Plain unicode61 matches what was typed. The cost is plurals and
-- suffixes — "engineers" no longer finds "engineer" — though the prefix still
-- covers the common direction ("engineer" finds "engineers").
--
-- Both tables are external-content, so 'rebuild' repopulates them from their
-- source tables and nothing is lost.

ALTER TABLE application ADD COLUMN job_req_id TEXT;

DROP TRIGGER application_fts_insert;
DROP TRIGGER application_fts_delete;
DROP TRIGGER application_fts_update;
DROP TABLE application_fts;

CREATE VIRTUAL TABLE application_fts USING fts5(
  company, role, job_req_id, description, notes, angle,
  content = 'application',
  content_rowid = 'id',
  tokenize = 'unicode61'
);

CREATE TRIGGER application_fts_insert AFTER INSERT ON application
BEGIN
  INSERT INTO application_fts(rowid, company, role, job_req_id, description, notes, angle)
  VALUES (NEW.id, NEW.company, NEW.role, NEW.job_req_id, NEW.description, NEW.notes, NEW.angle);
END;

CREATE TRIGGER application_fts_delete AFTER DELETE ON application
BEGIN
  INSERT INTO application_fts(application_fts, rowid, company, role, job_req_id, description, notes, angle)
  VALUES ('delete', OLD.id, OLD.company, OLD.role, OLD.job_req_id, OLD.description, OLD.notes, OLD.angle);
END;

CREATE TRIGGER application_fts_update AFTER UPDATE ON application
BEGIN
  INSERT INTO application_fts(application_fts, rowid, company, role, job_req_id, description, notes, angle)
  VALUES ('delete', OLD.id, OLD.company, OLD.role, OLD.job_req_id, OLD.description, OLD.notes, OLD.angle);
  INSERT INTO application_fts(rowid, company, role, job_req_id, description, notes, angle)
  VALUES (NEW.id, NEW.company, NEW.role, NEW.job_req_id, NEW.description, NEW.notes, NEW.angle);
END;

INSERT INTO application_fts(application_fts) VALUES ('rebuild');

DROP TRIGGER document_fts_insert;
DROP TRIGGER document_fts_delete;
DROP TRIGGER document_fts_update;
DROP TABLE document_fts;

CREATE VIRTUAL TABLE document_fts USING fts5(
  title, content_text,
  content = 'document',
  content_rowid = 'id',
  tokenize = 'unicode61'
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

INSERT INTO document_fts(document_fts) VALUES ('rebuild');
