import { useDatabase } from '../database'
import { DEFAULT_SORT } from '#shared/types'
import type {
  Application,
  ApplicationFilters,
  LookupOption,
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

const SELECT = `
  SELECT
    a.id, a.company, a.role, a.description,
    a.job_posting_link AS jobPostingLink, a.contact, a.apply_date AS applyDate,
    a.status_id AS statusId, s.label AS statusLabel, s.tone AS statusTone,
    s.is_terminal AS isTerminal,
    a.next_step_id AS nextStepId, n.label AS nextStepLabel,
    a.next_step_date_time AS nextStepDateTime,
    a.status_changed_at AS statusChangedAt,
    a.notes, a.submitted_to_unemployment AS submittedToUnemployment,
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

export function statuses(): StatusOption[] {
  return useDatabase()
    .prepare(
      `SELECT id, label, sort_order AS sortOrder, is_terminal AS isTerminal,
              is_active AS isActive, tone
       FROM status WHERE is_active = 1 ORDER BY sort_order`,
    )
    .all()
    .map((r) => {
      const row = r as { id: number; label: string; sortOrder: number; isTerminal: number; isActive: number; tone: StatusTone }
      return { ...row, isTerminal: Boolean(row.isTerminal), isActive: Boolean(row.isActive) }
    })
}

export function nextSteps(): LookupOption[] {
  return useDatabase()
    .prepare(
      `SELECT id, label, sort_order AS sortOrder, is_active AS isActive
       FROM next_step WHERE is_active = 1 ORDER BY sort_order`,
    )
    .all()
    .map((r) => {
      const row = r as { id: number; label: string; sortOrder: number; isActive: number }
      return { ...row, isActive: Boolean(row.isActive) }
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
