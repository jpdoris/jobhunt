import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
// Explicit .ts paths: scripts/add-application.ts imports this under plain Node.
import { useDatabase } from '../database/index.ts'
import { ACCEPTED_MIME } from './extract-text.ts'
import type { AcceptedMime } from './extract-text.ts'
import type { DocumentKind, DocumentRecord } from '#shared/types'

/**
 * Uploaded files live on disk; the database holds only the path, type and size.
 * Every query here is scoped by userId — see docs/PRD.md.
 */
export function documentsDir(): string {
  const dir = resolve(process.cwd(), 'data/documents')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Resolves a stored path and refuses anything that escapes the documents
 * directory. file_path is written by this module, but a traversal bug upstream
 * would otherwise turn a download endpoint into arbitrary file read.
 */
export function resolveStoredFile(filePath: string): string {
  const dir = documentsDir()
  const full = resolve(dir, filePath)
  if (full !== dir && !full.startsWith(dir + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file path' })
  }
  return full
}

const SELECT = `
  SELECT
    d.id, d.kind_id AS kindId, k.label AS kindLabel, d.title,
    d.file_path AS filePath, d.mime_type AS mimeType, d.byte_size AS byteSize,
    d.content_text AS contentText,
    d.created_at AS createdAt, d.updated_at AS updatedAt,
    (SELECT count(*) FROM application_document ad WHERE ad.document_id = d.id) AS attachedCount
  FROM document d
  JOIN document_kind k ON k.id = d.kind_id
`

type Row = Omit<DocumentRecord, 'hasText'> & { contentText: string | null }

const toDocument = (r: Row): DocumentRecord => ({
  ...r,
  // The list view does not need the whole body, only whether search can see it.
  hasText: Boolean(r.contentText && r.contentText.trim().length),
})

export function listDocuments(
  userId: number,
  opts: { kindId?: number; search?: string } = {},
): DocumentRecord[] {
  const db = useDatabase()
  const where = ['d.user_id = @userId']
  const params: Record<string, unknown> = { userId }

  if (opts.kindId) {
    where.push('d.kind_id = @kindId')
    params.kindId = opts.kindId
  }
  if (opts.search) {
    where.push('d.id IN (SELECT rowid FROM document_fts WHERE document_fts MATCH @search)')
    params.search = ftsQuery(opts.search)
  }

  const rows = db
    .prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY k.sort_order, d.created_at DESC`)
    .all(params) as Row[]

  return rows.map(toDocument).map((d) => ({ ...d, contentText: null }))
}

export function getDocument(userId: number, id: number): DocumentRecord | null {
  const row = useDatabase()
    .prepare(`${SELECT} WHERE d.id = @id AND d.user_id = @userId`)
    .get({ id, userId }) as Row | undefined
  return row ? toDocument(row) : null
}

export function documentKinds(): DocumentKind[] {
  return useDatabase()
    .prepare(
      `SELECT id, label, sort_order AS sortOrder FROM document_kind
       WHERE is_active = 1 ORDER BY sort_order`,
    )
    .all() as DocumentKind[]
}

export function createDocument(input: {
  userId: number
  kindId: number
  title: string
  filePath: string | null
  mimeType: string | null
  byteSize: number | null
  contentText: string | null
}): number {
  const { lastInsertRowid } = useDatabase()
    .prepare(
      `INSERT INTO document
         (user_id, kind_id, title, file_path, mime_type, byte_size, content_text)
       VALUES (@userId, @kindId, @title, @filePath, @mimeType, @byteSize, @contentText)`,
    )
    .run(input)
  return Number(lastInsertRowid)
}

/**
 * Writes an uploaded file for an existing document row and records its path.
 *
 * Named from the row id, never from the uploaded filename — a user-supplied
 * name is the classic path-traversal vector, and ids are already unique.
 */
export function saveDocumentFile(
  userId: number,
  id: number,
  data: Buffer,
  mimeType: AcceptedMime,
): string {
  const filePath = `${id}${ACCEPTED_MIME[mimeType]}`
  writeFileSync(resolve(documentsDir(), filePath), data)
  useDatabase()
    .prepare('UPDATE document SET file_path = ? WHERE id = ? AND user_id = ?')
    .run(filePath, id, userId)
  return filePath
}

export function updateDocument(
  userId: number,
  id: number,
  input: { title: string; kindId: number; contentText: string | null },
): boolean {
  const { changes } = useDatabase()
    .prepare(
      `UPDATE document SET title = @title, kind_id = @kindId, content_text = @contentText
       WHERE id = @id AND user_id = @userId`,
    )
    .run({ ...input, id, userId })
  return changes > 0
}

/** Removes the row and its file. Attachments cascade; applications are untouched. */
export function deleteDocument(userId: number, id: number): boolean {
  const db = useDatabase()
  const doc = getDocument(userId, id)
  if (!doc) return false

  db.prepare('DELETE FROM document WHERE id = ? AND user_id = ?').run(id, userId)

  if (doc.filePath) {
    // The row is already gone; a missing file must not fail the request.
    try {
      rmSync(resolveStoredFile(doc.filePath), { force: true })
    } catch {
      /* orphaned file, harmless */
    }
  }
  return true
}

/* Attachments ------------------------------------------------------------- */

export function documentsForApplication(userId: number, applicationId: number): DocumentRecord[] {
  const rows = useDatabase()
    .prepare(
      `${SELECT}
       JOIN application_document ad ON ad.document_id = d.id
       JOIN application a ON a.id = ad.application_id
       WHERE ad.application_id = @applicationId
         AND a.user_id = @userId
         AND d.user_id = @userId
       ORDER BY k.sort_order, d.title`,
    )
    .all({ applicationId, userId }) as Row[]
  return rows.map(toDocument).map((d) => ({ ...d, contentText: null }))
}

/** Both sides are ownership-checked, so one user cannot attach to another's row. */
export function attachDocument(userId: number, applicationId: number, documentId: number): boolean {
  const db = useDatabase()
  const owns = db
    .prepare(
      `SELECT
         (SELECT count(*) FROM application WHERE id = @applicationId AND user_id = @userId) AS app,
         (SELECT count(*) FROM document    WHERE id = @documentId    AND user_id = @userId) AS doc`,
    )
    .get({ applicationId, documentId, userId }) as { app: number; doc: number }

  if (!owns.app || !owns.doc) return false

  db.prepare(
    `INSERT OR IGNORE INTO application_document (application_id, document_id) VALUES (?, ?)`,
  ).run(applicationId, documentId)
  return true
}

export function detachDocument(userId: number, applicationId: number, documentId: number): boolean {
  const { changes } = useDatabase()
    .prepare(
      `DELETE FROM application_document
       WHERE application_id = @applicationId AND document_id = @documentId
         AND EXISTS (SELECT 1 FROM application WHERE id = @applicationId AND user_id = @userId)`,
    )
    .run({ applicationId, documentId, userId })
  return changes > 0
}

/** Same quoting rule as application search: bare punctuation is an FTS5 syntax error. */
function ftsQuery(input: string): string {
  const terms = input
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter(Boolean)
  if (!terms.length) return '""'
  return terms.map((t) => `"${t}"*`).join(' AND ')
}
