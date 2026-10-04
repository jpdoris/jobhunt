// Explicit .ts paths and no #shared alias for value imports: scripts/add-application.ts
// imports this module under plain Node, which neither guesses extensions nor
// knows Nuxt's aliases. Type-only imports are erased, so those may keep it.
import { useDatabase } from '../database/index.ts'
import type { DB } from '../database/index.ts'
import type { ApplicationInput } from './validation.ts'
import { DEFAULT_SORT } from '../../shared/types.ts'
import type {
  Application,
  ApplicationFilters,
  Milestone,
  MilestoneCounts,
  NextStepOption,
  SortColumn,
  SortDirection,
  StatusTone,
  StatusCount,
  StatusOption,
} from '#shared/types'

/**
 * Sort column -> SQL expression. An allowlist, never interpolation of user
 * input: `sort` arrives from the query string and lands inside ORDER BY.
 *
 * status and nextStep sort by sort_order rather than label — pipeline order is
 * the meaningful one, and alphabetical would put "Rejected" mid-funnel.
 *
 * Text uses COLLATE NOCASE because SQLite's default BINARY collation sorts all
 * uppercase before any lowercase ('Zillow' before 'apple').
 */
const SORT_SQL: Record<SortColumn, string> = {
  company: 'a.company COLLATE NOCASE',
  role: 'a.role COLLATE NOCASE',
  status: 's.sort_order',
  nextStep: 'n.sort_order',
  when: 'a.next_step_date_time',
  applied: 'a.apply_date',
  filed: 'a.submitted_to_unemployment',
}

/**
 * NULLS LAST in both directions: a row with no date is missing information, not
 * the earliest date, so it belongs at the bottom either way. id breaks ties so
 * equal values keep a stable order between requests.
 */
function orderBy(sort?: { column: SortColumn; direction: SortDirection }): string {
  const { column, direction } = sort ?? DEFAULT_SORT
  const dir = direction === 'asc' ? 'ASC' : 'DESC'
  return `ORDER BY ${SORT_SQL[column]} ${dir} NULLS LAST, a.id DESC`
}

/**
 * "This application reached an interview." Expects the `a` (application) and
 * `s` (its current status) aliases the queries here already use.
 *
 * History OR current status, deliberately: most applications carry no
 * status_event at all (the spreadsheet import had no transition dates), so
 * history alone would report zero for a row sitting at "Interviewed (round 2)".
 *
 * Which statuses count is `status.is_interview`, never a label match — see
 * CLAUDE.md rule 3.
 */
const everReached = (flag: 'is_interview' | 'is_offer') => `(
  s.${flag} = 1
  OR EXISTS (
    SELECT 1 FROM status_event e
      JOIN status es ON es.id = e.status_id
     WHERE e.application_id = a.id AND es.${flag} = 1
  )
)`

export const INTERVIEWED_SQL = everReached('is_interview')
export const OFFERED_SQL = everReached('is_offer')

/**
 * The milestone filters. `open` and `closedNoOffer` read current status, which
 * is right — those are present-tense questions — but each spans several
 * statuses, so the single-status filter cannot express them.
 *
 * closedNoOffer has to consult history too: an application can pass through
 * `Offer received` and still end at `Expired / Not pursued`, and that is not a
 * search that ended without an offer.
 */
export const MILESTONE_SQL: Record<Milestone, string> = {
  interviewed: INTERVIEWED_SQL,
  offered: OFFERED_SQL,
  open: 's.is_terminal = 0',
  closedNoOffer: `(s.is_terminal = 1 AND NOT ${OFFERED_SQL})`,
}

/**
 * Closing an application closes out its next step.
 *
 * A terminal status means nothing is pending, so the next step moves to the
 * "nothing pending" option and the next-step date is dropped — otherwise a
 * rejected application keeps a phantom interview on the calendar and shows a
 * date beside "None" in the list.
 *
 * Both halves are flags, never labels (CLAUDE.md rule 3): `status.is_terminal`
 * decides that the application is closed, `next_step.is_none` decides which
 * option it lands on. Expressed as SQL rather than as a lookup in TypeScript so
 * it lands in the same statement as the status change, and so every write path
 * — create, edit, and the history re-sync — can share one definition.
 *
 * `fallback` is what to store when the status is *not* terminal: the incoming
 * `@nextStepId` / `@nextStepDateTime` on the write endpoints, or the row's own
 * columns where the status is moving on its own. Reopening never restores a
 * next step — nothing records what it used to be.
 *
 * COALESCE covers a database with nothing flagged is_none: next_step_id is NOT
 * NULL, and a 500 on save would be a worse failure than an unchanged next step.
 */
export function closedNextStepSql(
  idFallback: string,
  dateTimeFallback: string,
): { id: string; dateTime: string } {
  const closed = '(SELECT is_terminal FROM status WHERE id = @statusId) = 1'
  return {
    id: `CASE WHEN ${closed}
              THEN COALESCE((SELECT id FROM next_step WHERE is_none = 1), ${idFallback})
              ELSE ${idFallback} END`,
    dateTime: `CASE WHEN ${closed} THEN NULL ELSE ${dateTimeFallback} END`,
  }
}

/**
 * Inserts one application for `userId` and returns its id. The one write path
 * for new applications — the create endpoint and scripts/add-application.ts
 * both call it, so closing out the next step (closedNextStepSql) and the
 * user_id stamp cannot differ between them.
 *
 * `input` must already be validated (ApplicationInput). Ownership is the
 * caller's: userId comes from the session or from a looked-up email, never
 * from the request body.
 */
export function createApplication(
  userId: number,
  input: ApplicationInput,
  db: DB = useDatabase(),
): number {
  // Filed as already closed — a rejection logged after the fact — still has no
  // next step, so the same rule applies here as on the way to a terminal status.
  const nextStep = closedNextStepSql('@nextStepId', '@nextStepDateTime')

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO application (
         user_id, company, role, description, job_posting_link, contact,
         apply_date, status_id, next_step_id, next_step_date_time, notes, angle,
         submitted_to_unemployment, status_changed_at
       ) VALUES (
         @userId, @company, @role, @description, @jobPostingLink, @contact,
         @applyDate, @statusId, ${nextStep.id}, ${nextStep.dateTime}, @notes, @angle,
         @submittedToUnemployment, @statusChangedAt
       )`,
    )
    .run({
      userId,
      ...input,
      statusChangedAt: input.statusChangedAt ?? null,
      submittedToUnemployment: Number(input.submittedToUnemployment),
    })
  return Number(lastInsertRowid)
}

const SELECT = `
  SELECT
    a.id, a.company, a.role, a.description,
    a.job_posting_link AS jobPostingLink, a.contact, a.apply_date AS applyDate,
    a.status_id AS statusId, s.label AS statusLabel, s.tone AS statusTone,
    s.is_terminal AS isTerminal,
    a.next_step_id AS nextStepId, n.label AS nextStepLabel,
    a.next_step_date_time AS nextStepDateTime,
    a.status_changed_at AS statusChangedAt,
    a.notes, a.angle, a.submitted_to_unemployment AS submittedToUnemployment,
    a.created_at AS createdAt, a.updated_at AS updatedAt
  FROM application a
  JOIN status s ON s.id = a.status_id
  JOIN next_step n ON n.id = a.next_step_id
`

type Row = Omit<Application, 'isTerminal' | 'submittedToUnemployment'> & {
  isTerminal: number
  submittedToUnemployment: number
}

const toApplication = (r: Row): Application => ({
  ...r,
  isTerminal: Boolean(r.isTerminal),
  submittedToUnemployment: Boolean(r.submittedToUnemployment),
})

/**
 * Every query in this module is scoped by userId. See docs/PRD.md — a missing
 * user_id predicate is a data-leak bug, not a style issue.
 */
export function listApplications(
  userId: number,
  filters: ApplicationFilters = {},
  sort?: { column: SortColumn; direction: SortDirection },
): Application[] {
  const db = useDatabase()
  const where: string[] = ['a.user_id = @userId']
  const params: Record<string, unknown> = { userId }

  if (filters.search) {
    // FTS5 rather than LIKE — descriptions run to ~5.5k characters.
    where.push(`a.id IN (SELECT rowid FROM application_fts WHERE application_fts MATCH @search)`)
    params.search = ftsQuery(filters.search)
  }
  if (filters.statusId) {
    where.push('a.status_id = @statusId')
    params.statusId = filters.statusId
  }
  if (filters.nextStepId) {
    where.push('a.next_step_id = @nextStepId')
    params.nextStepId = filters.nextStepId
  }
  if (filters.appliedFrom) {
    where.push('a.apply_date >= @appliedFrom')
    params.appliedFrom = filters.appliedFrom
  }
  if (filters.appliedTo) {
    where.push('a.apply_date <= @appliedTo')
    params.appliedTo = filters.appliedTo
  }
  if (filters.submittedToUnemployment) {
    where.push('a.submitted_to_unemployment = 1')
  }
  if (filters.milestone) {
    where.push(MILESTONE_SQL[filters.milestone])
  }

  const rows = db
    .prepare(`${SELECT} WHERE ${where.join(' AND ')} ${orderBy(sort)}`)
    .all(params) as Row[]

  return rows.map(toApplication)
}

export function getApplication(userId: number, id: number): Application | null {
  const db = useDatabase()
  const row = db.prepare(`${SELECT} WHERE a.id = @id AND a.user_id = @userId`).get({ id, userId }) as
    | Row
    | undefined
  return row ? toApplication(row) : null
}

export function statusCounts(userId: number): StatusCount[] {
  const db = useDatabase()
  // LEFT JOIN so zero-count statuses still render — the empty parts of the
  // pipeline are meant to be visible (docs/PRD.md).
  return db
    .prepare(
      `SELECT s.id AS statusId, s.label, s.is_terminal AS isTerminal, count(a.id) AS count
       FROM status s
       LEFT JOIN application a ON a.status_id = s.id AND a.user_id = @userId
       WHERE s.is_active = 1
       GROUP BY s.id
       ORDER BY s.sort_order`,
    )
    .all({ userId })
    .map((r) => {
      const row = r as { statusId: number; label: string; isTerminal: number; count: number }
      return { ...row, isTerminal: Boolean(row.isTerminal) }
    })
}

/**
 * One row, one pass. These deliberately overlap — an application at "Offer
 * received" is both open and offered, and an interviewed one lands in whichever
 * of open/closed it ended in — so they are lenses, not a partition, and must
 * never be presented as though they sum to the total.
 */
export function milestoneCounts(userId: number): MilestoneCounts {
  const sum = (sql: string, alias: Milestone) =>
    `sum(CASE WHEN ${sql} THEN 1 ELSE 0 END) AS ${alias}`

  const row = useDatabase()
    .prepare(
      `SELECT count(*) AS total,
              ${(Object.keys(MILESTONE_SQL) as Milestone[])
                .map((m) => sum(MILESTONE_SQL[m], m))
                .join(',\n              ')}
         FROM application a
         JOIN status s ON s.id = a.status_id
        WHERE a.user_id = @userId`,
    )
    .get({ userId }) as Record<string, number | null>

  // sum() over zero rows is NULL, not 0 — a brand new account would render "—".
  return {
    total: row.total ?? 0,
    interviewed: row.interviewed ?? 0,
    offered: row.offered ?? 0,
    open: row.open ?? 0,
    closedNoOffer: row.closedNoOffer ?? 0,
  }
}

export function statuses(): StatusOption[] {
  return useDatabase()
    .prepare(
      `SELECT id, label, sort_order AS sortOrder, is_terminal AS isTerminal,
              is_active AS isActive, tone, is_interview AS isInterview,
              is_offer AS isOffer
       FROM status WHERE is_active = 1 ORDER BY sort_order`,
    )
    .all()
    .map((r) => {
      const row = r as { id: number; label: string; sortOrder: number; isTerminal: number; isActive: number; tone: StatusTone; isInterview: number; isOffer: number }
      return {
        ...row,
        isTerminal: Boolean(row.isTerminal),
        isActive: Boolean(row.isActive),
        isInterview: Boolean(row.isInterview),
        isOffer: Boolean(row.isOffer),
      }
    })
}

export function nextSteps(): NextStepOption[] {
  return useDatabase()
    .prepare(
      `SELECT id, label, sort_order AS sortOrder, is_active AS isActive,
              is_none AS isNone
       FROM next_step WHERE is_active = 1 ORDER BY sort_order`,
    )
    .all()
    .map((r) => {
      const row = r as { id: number; label: string; sortOrder: number; isActive: number; isNone: number }
      return { ...row, isActive: Boolean(row.isActive), isNone: Boolean(row.isNone) }
    })
}

/**
 * User input reaches FTS5's query parser, where bare punctuation is a syntax
 * error. Quote each term and append * for prefix matching.
 */
function ftsQuery(input: string): string {
  const terms = input
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter(Boolean)
  if (!terms.length) return '""'
  return terms.map((t) => `"${t}"*`).join(' AND ')
}
