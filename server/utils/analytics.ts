import { useDatabase } from '../database'
import { INTERVIEWED_SQL } from './applications'
import type { Analytics } from '#shared/types'

/**
 * Two different coverage levels live in here, and conflating them would be the
 * easiest way to publish a wrong number:
 *
 *   - Counts and volume come from the applications themselves, so they cover
 *     every row.
 *   - Durations come from status_event, which most applications still lack
 *     because the spreadsheet import had no transition dates. Every duration
 *     carries its own sample size so a median of four is never read as a trend.
 */

/** Median rather than mean: at these sample sizes one outlier would own the mean. */
function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

const DAY = 86_400_000
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)

export function analytics(userId: number, stalledAfterDays = 30): Analytics {
  const db = useDatabase()

  const byStatus = db
    .prepare(
      `SELECT s.label, s.tone, s.is_terminal AS isTerminal, count(a.id) AS count
         FROM status s
         LEFT JOIN application a ON a.status_id = s.id AND a.user_id = @userId
        WHERE s.is_active = 1
        GROUP BY s.id ORDER BY s.sort_order`,
    )
    .all({ userId })
    .map((r) => {
      const row = r as { label: string; tone: string; isTerminal: number; count: number }
      return { ...row, isTerminal: Boolean(row.isTerminal) }
    })

  const total = byStatus.reduce((n, s) => n + s.count, 0)
  const live = byStatus.filter((s) => !s.isTerminal).reduce((n, s) => n + s.count, 0)

  // Same rule as the list filter, so the tile and the filtered view agree.
  const interviewed = (
    db
      .prepare(
        `SELECT count(*) AS n
           FROM application a
           JOIN status s ON s.id = a.status_id
          WHERE a.user_id = @userId AND ${INTERVIEWED_SQL}`,
      )
      .get({ userId }) as { n: number }
  ).n

  const perMonth = db
    .prepare(
      `SELECT substr(apply_date, 1, 7) AS month, count(*) AS count
         FROM application
        WHERE user_id = @userId AND apply_date IS NOT NULL
        GROUP BY month ORDER BY month`,
    )
    .all({ userId }) as { month: string; count: number }[]

  /* Durations — status_event only, so coverage is partial by construction. */

  const firstMoves = db
    .prepare(
      `SELECT a.apply_date AS applyDate, min(e.changed_at) AS movedAt
         FROM application a
         JOIN status_event e ON e.application_id = a.id
         JOIN status s ON s.id = e.status_id
        WHERE a.user_id = @userId AND a.apply_date IS NOT NULL AND s.label != 'Applied'
        GROUP BY a.id`,
    )
    .all({ userId }) as { applyDate: string; movedAt: string }[]

  // apply_date is user-entered and can post-date the row, so a negative gap is
  // possible and meaningless. Drop those rather than let them drag the median.
  const responseDays = firstMoves.map((r) => days(r.applyDate, r.movedAt)).filter((d) => d >= 0)

  /** `match` is a predicate on the event's status, aliased `s`. */
  const outcomeDays = (match: string) =>
    (
      db
        .prepare(
          `SELECT a.apply_date AS applyDate, min(e.changed_at) AS reachedAt
             FROM application a
             JOIN status_event e ON e.application_id = a.id
             JOIN status s ON s.id = e.status_id
            WHERE a.user_id = @userId AND a.apply_date IS NOT NULL AND ${match}
            GROUP BY a.id`,
        )
        .all({ userId }) as { applyDate: string; reachedAt: string }[]
    )
      .map((r) => days(r.applyDate, r.reachedAt))
      .filter((d) => d >= 0)

  // TODO: 'Rejected' is still a label match, and rule 3 says it should not be.
  // is_terminal is too broad (it catches Expired and both Offer outcomes), so
  // fixing it properly means another flag — deliberately not done here.
  const rejection = outcomeDays(`s.label = 'Rejected'`)
  // is_offer rather than label = 'Offer received': history that jumps straight
  // to "Offer accepted" is still an offer, and the label match missed it.
  const offer = outcomeDays('s.is_offer = 1')

  /* Stalled — live applications with no movement lately. Falls back to
     apply_date, so the 288 imported rows with no history still qualify. */

  const stalled = (
    db
      .prepare(
        `SELECT a.id, a.company, a.role, s.label AS statusLabel,
                COALESCE(a.status_changed_at, a.apply_date) AS since
           FROM application a
           JOIN status s ON s.id = a.status_id
          WHERE a.user_id = @userId AND s.is_terminal = 0
            AND COALESCE(a.status_changed_at, a.apply_date) IS NOT NULL
          ORDER BY since`,
      )
      .all({ userId }) as {
      id: number
      company: string
      role: string | null
      statusLabel: string
      since: string
    }[]
  )
    .map((r) => ({ ...r, days: days(r.since.slice(0, 10), new Date().toISOString()) }))
    .filter((r) => r.days >= stalledAfterDays)

  return {
    total,
    live,
    ended: total - live,
    interviewed,
    byStatus,
    perMonth,
    stalledAfterDays,
    stalled,
    durations: {
      response: { n: responseDays.length, median: median(responseDays), values: responseDays },
      rejection: { n: rejection.length, median: median(rejection) },
      offer: { n: offer.length, median: median(offer) },
      withHistory: (
        db
          .prepare(
            `SELECT count(DISTINCT e.application_id) AS n FROM status_event e
               JOIN application a ON a.id = e.application_id WHERE a.user_id = ?`,
          )
          .get(userId) as { n: number }
      ).n,
    },
  }
}
