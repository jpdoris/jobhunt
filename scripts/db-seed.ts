/**
 * Loads data/seed-applications.csv into the database for a given user.
 *
 * Idempotent by design (docs/PRD.md): it deletes the user's existing
 * applications first, so running it twice leaves one copy, not two.
 *
 *   npm run db:seed you@example.com
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { closeDatabase, useDatabase } from '../server/database/index.ts'

const argv = process.argv.slice(2)

/** Positional first, so the common form needs no `--` separator from npm. */
function targetEmail(): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i]!
    if (value === '--email') return argv[i + 1]
    if (!value.startsWith('--')) return value
  }
  return undefined
}

/** Minimal RFC-4180 reader — the seed file has quoted fields with commas and newlines. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }

  const [header, ...body] = rows.filter((r) => r.some((v) => v !== ''))
  return body.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ''])))
}

const email = targetEmail()
if (!email) {
  console.error('Usage: npm run db:seed you@example.com')
  process.exit(1)
}

const db = useDatabase()

const user = db.prepare('SELECT id FROM user WHERE email = ?').get(email) as
  | { id: number }
  | undefined
if (!user) {
  console.error(`No user with email ${email}. Create one first: npm run user:create`)
  process.exit(1)
}

const statusId = new Map(
  (db.prepare('SELECT id, label FROM status').all() as { id: number; label: string }[]).map(
    (r) => [r.label, r.id],
  ),
)
const nextStepId = new Map(
  (db.prepare('SELECT id, label FROM next_step').all() as { id: number; label: string }[]).map(
    (r) => [r.label, r.id],
  ),
)

const rows = parseCsv(readFileSync(resolve(process.cwd(), 'data/seed-applications.csv'), 'utf8'))

const insert = db.prepare(`
  INSERT INTO application (
    user_id, company, role, description, job_posting_link, contact,
    apply_date, status_id, next_step_id, next_step_date_time, notes,
    submitted_to_unemployment
  ) VALUES (
    @user_id, @company, @role, @description, @job_posting_link, @contact,
    @apply_date, @status_id, @next_step_id, @next_step_date_time, @notes,
    @submitted_to_unemployment
  )
`)

const nullIfBlank = (v: string) => (v === '' ? null : v)

const load = db.transaction(() => {
  const removed = db.prepare('DELETE FROM application WHERE user_id = ?').run(user.id).changes

  for (const [i, r] of rows.entries()) {
    const sid = statusId.get(r.status!)
    const nid = nextStepId.get(r.next_step!)
    if (!sid) throw new Error(`row ${i + 2}: unknown status "${r.status}"`)
    if (!nid) throw new Error(`row ${i + 2}: unknown next step "${r.next_step}"`)

    insert.run({
      user_id: user.id,
      company: r.company,
      role: nullIfBlank(r.role!),
      description: nullIfBlank(r.description!),
      job_posting_link: nullIfBlank(r.job_posting_link!),
      contact: nullIfBlank(r.contact!),
      apply_date: nullIfBlank(r.apply_date!),
      status_id: sid,
      next_step_id: nid,
      next_step_date_time: nullIfBlank(r.next_step_date_time!),
      notes: nullIfBlank(r.notes!),
      submitted_to_unemployment: Number(r.submitted_to_unemployment),
    })
  }

  // The insert trigger writes a status_event per row, but the spreadsheet never
  // recorded when a status changed (docs/PRD.md). Inventing timestamps would
  // poison every duration metric, so seeded applications start with no history.
  const events = db
    .prepare('DELETE FROM status_event WHERE application_id IN (SELECT id FROM application WHERE user_id = ?)')
    .run(user.id).changes

  return { removed, events }
})

const { removed, events } = load()
console.log(
  `Seeded ${rows.length} applications for ${email}` +
    (removed ? ` (replaced ${removed} existing)` : '') +
    `; cleared ${events} reconstructed status events.`,
)
closeDatabase()
