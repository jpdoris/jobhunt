/**
 * Creates one application from JSON, optionally attaching résumé and
 * cover-letter files. The write path for anything outside the browser — chiefly
 * the /resume-and-cover-letter skill, which drafts the documents in a Claude
 * session and hands the finished record over here. The app itself still never
 * fetches a posting or writes a document (docs/PRD.md, Non-Goals).
 *
 *   npm run app:add you@example.com < posting.json
 *   npm run app:add -- you@example.com --file posting.json --dry-run
 *
 * Input, camelCase like the API (only company and role are required):
 *
 *   {
 *     "company": "Acme", "role": "Senior Frontend Engineer",
 *     "jobPostingLink": "https://…", "description": "…", "contact": null,
 *     "applyDate": "2026-10-04",           floating date, never converted
 *     "status": "Applied",                 a status label; default: first in pipeline order
 *     "nextStep": "Awaiting response",     a next-step label; default: first live option
 *     "nextStepDateTime": null,            UTC "YYYY-MM-DD HH:MM:SS"
 *     "angle": "Senior Vue frontend", "notes": "…",
 *     "submittedToUnemployment": false,
 *     "documents": [ { "path": "out/resume.pdf", "kind": "Resume", "title": "…" } ]
 *   }
 *
 * Labels are looked up in the database, never assumed (CLAUDE.md rule 3); an
 * unknown one fails with the valid list. Prints the result as JSON on stdout.
 */
import { readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { MAX_UPLOAD_BYTES } from '../shared/types.ts'
import { closeDatabase, useDatabase } from '../server/database/index.ts'
import { createApplication } from '../server/utils/applications.ts'
import { attachDocument, createDocument, saveDocumentFile } from '../server/utils/documents.ts'
import { ACCEPTED_MIME, extractText } from '../server/utils/extract-text.ts'
import type { AcceptedMime } from '../server/utils/extract-text.ts'
import { ApplicationInput } from '../server/utils/validation.ts'

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(name)
const option = (name: string) => {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}
/** Positional first, so the common form needs no `--` separator from npm. */
const email = argv.find((v, i) => !v.startsWith('--') && argv[i - 1] !== '--file')
const dryRun = flag('--dry-run')

function fail(message: string): never {
  console.error(message)
  closeDatabase()
  process.exit(1)
}

if (!email) fail('Usage: npm run app:add you@example.com < posting.json')

const file = option('--file')
let raw: Record<string, unknown>
try {
  raw = JSON.parse(readFileSync(file ? resolve(file) : 0, 'utf8'))
} catch (error) {
  fail(`Could not read JSON from ${file ?? 'stdin'}: ${(error as Error).message}`)
}

const db = useDatabase()

const user = db.prepare('SELECT id FROM user WHERE email = ?').get(email) as
  | { id: number }
  | undefined
if (!user) fail(`No user with email ${email}. Create one first: npm run user:create`)

type Lookup = { id: number; label: string }

/** Active rows only — a retired value is not offered for new applications. */
function pick(table: 'status' | 'next_step' | 'document_kind', label: unknown, fallback?: Lookup) {
  const rows = db
    .prepare(`SELECT id, label FROM ${table} WHERE is_active = 1 ORDER BY sort_order`)
    .all() as Lookup[]
  if (label === undefined || label === null || label === '') {
    if (fallback) return fallback
    fail(`${table} is required. One of: ${rows.map((r) => r.label).join(' | ')}`)
  }
  const row = rows.find((r) => r.label === label)
  if (!row) fail(`Unknown ${table} "${label}". One of: ${rows.map((r) => r.label).join(' | ')}`)
  return row
}

const status = pick(
  'status',
  raw.status,
  db.prepare('SELECT id, label FROM status WHERE is_active = 1 ORDER BY sort_order LIMIT 1').get() as Lookup,
)
// Default to the first option that means something is pending; closedNextStepSql
// still moves a terminal status to the is_none option regardless.
const nextStep = pick(
  'next_step',
  raw.nextStep,
  db
    .prepare('SELECT id, label FROM next_step WHERE is_active = 1 AND is_none = 0 ORDER BY sort_order LIMIT 1')
    .get() as Lookup,
)

const parsed = ApplicationInput.safeParse({ ...raw, statusId: status.id, nextStepId: nextStep.id })
if (!parsed.success) {
  fail(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n'))
}
const input = parsed.data
// The schema allows a null role for the four seed rows that lack one; new
// applications must have one (CLAUDE.md).
if (!input.role) fail('role is required for a new application')

/* Documents ---------------------------------------------------------------- */

const MIME_BY_EXT = Object.fromEntries(
  Object.entries(ACCEPTED_MIME).map(([mime, ext]) => [ext, mime as AcceptedMime]),
)

type DocIn = { path?: unknown; kind?: unknown; title?: unknown }
const docsIn = (Array.isArray(raw.documents) ? raw.documents : []) as DocIn[]

const documents = await Promise.all(
  docsIn.map(async (d) => {
    if (typeof d.path !== 'string' || !d.path) fail('Every document needs a "path"')
    const path = resolve(d.path)
    const mimeType = MIME_BY_EXT[extname(path).toLowerCase()]
    if (!mimeType) fail(`${d.path}: accepted types are ${Object.values(ACCEPTED_MIME).join(', ')}`)
    let data: Buffer
    try {
      data = readFileSync(path)
    } catch (error) {
      fail(`${d.path}: ${(error as Error).message}`)
    }
    if (data.length > MAX_UPLOAD_BYTES) fail(`${d.path}: over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`)
    const kind = pick('document_kind', d.kind)
    const title =
      typeof d.title === 'string' && d.title.trim()
        ? d.title.trim()
        : basename(path, extname(path))
    // Extract before the transaction opens: better-sqlite3 transactions are
    // synchronous, and extraction is not.
    const extraction = await extractText(data, mimeType)
    return { path, mimeType, data, kind, title, extraction }
  }),
)

/* Write -------------------------------------------------------------------- */

// Re-applying to the same role is normal (CLAUDE.md), so this informs rather
// than refuses — but an accidental double-run should be visible.
const existing = db
  .prepare(
    `SELECT a.id, a.role, a.apply_date AS applyDate, s.label AS status
       FROM application a JOIN status s ON s.id = a.status_id
      WHERE a.user_id = ? AND a.company = ? COLLATE NOCASE
      ORDER BY a.apply_date DESC`,
  )
  .all(user.id, input.company)

// What closedNextStepSql will store, for the dry run's benefit. The real run
// reports the saved row instead, so this is only ever a preview.
const closesOut = db.prepare('SELECT is_terminal FROM status WHERE id = ?').get(status.id) as {
  is_terminal: number
}
const noneStep = db.prepare('SELECT label FROM next_step WHERE is_none = 1').get() as
  | { label: string }
  | undefined

const summary = {
  dryRun,
  company: input.company,
  role: input.role,
  status: status.label,
  nextStep: closesOut.is_terminal && noneStep ? noneStep.label : nextStep.label,
  nextStepDateTime: closesOut.is_terminal ? null : input.nextStepDateTime,
  applyDate: input.applyDate,
  angle: input.angle,
  documents: documents.map((d) => ({
    title: d.title,
    kind: d.kind.label,
    searchable: d.extraction.extracted,
    ...(d.extraction.note ? { note: d.extraction.note } : {}),
  })),
  existingForCompany: existing,
}

if (dryRun) {
  console.log(JSON.stringify(summary, null, 2))
  closeDatabase()
  process.exit(0)
}

// Files are written inside the transaction; if a later step throws, the rows
// roll back and at worst an orphaned file is left in data/documents/.
const id = db.transaction(() => {
  const applicationId = createApplication(user.id, input, db)
  for (const d of documents) {
    const documentId = createDocument({
      userId: user.id,
      kindId: d.kind.id,
      title: d.title,
      filePath: null,
      mimeType: d.mimeType,
      byteSize: d.data.length,
      contentText: d.extraction.text || null,
    })
    saveDocumentFile(user.id, documentId, d.data, d.mimeType)
    if (!attachDocument(user.id, applicationId, documentId)) {
      throw new Error(`Could not attach document ${documentId}`)
    }
  }
  return applicationId
})()

const saved = db
  .prepare(
    `SELECT s.label AS status, n.label AS nextStep, a.next_step_date_time AS nextStepDateTime
       FROM application a
       JOIN status s ON s.id = a.status_id
       JOIN next_step n ON n.id = a.next_step_id
      WHERE a.id = ? AND a.user_id = ?`,
  )
  .get(id, user.id) as { status: string; nextStep: string; nextStepDateTime: string | null }

console.log(JSON.stringify({ id, path: `/applications/${id}`, ...summary, ...saved }, null, 2))
closeDatabase()
