import { useDatabase } from '../database'
import { closedNextStepSql } from './applications'
import type { StatusEvent } from '#shared/types'

/**
 * The one place allowed to write status_event directly.
 *
 * CLAUDE.md rule 7 says application code never inserts here, and that still
 * holds everywhere else: it exists so a status change cannot be recorded
 * inconsistently or forgotten. Deliberately correcting history is a different
 * act, and it needs a door. This module is that door — narrow, ownership
 * checked, and always followed by syncCurrentStatus().
 */

/** Ownership check shared by every mutation below. */
function ownsApplication(userId: number, applicationId: number): boolean {
  return Boolean(
    useDatabase()
      .prepare('SELECT 1 FROM application WHERE id = ? AND user_id = ?')
      .get(applicationId, userId),
  )
}

export function listHistory(userId: number, applicationId: number): StatusEvent[] {
  return useDatabase()
    .prepare(
      `SELECT e.id, e.status_id AS statusId, s.label AS statusLabel, s.tone AS statusTone,
              e.changed_at AS changedAt
         FROM status_event e
         JOIN status s ON s.id = e.status_id
         JOIN application a ON a.id = e.application_id
        WHERE e.application_id = @applicationId AND a.user_id = @userId
        ORDER BY e.changed_at, e.id`,
    )
    .all({ applicationId, userId }) as StatusEvent[]
}

/**
 * Points the application at whatever the timeline now says is most recent, so
 * the badge on the page can never contradict the history below it.
 *
 * Writing status_id here would normally fire the append trigger and duplicate
 * the winning event — migration 0004 added a NOT EXISTS guard to the trigger
 * precisely so this is safe. status_changed_at is set first, in the same
 * statement, so the guard compares against the right timestamp.
 */
export function syncCurrentStatus(applicationId: number): void {
  const db = useDatabase()
  const latest = db
    .prepare(
      `SELECT status_id AS statusId, changed_at AS changedAt
         FROM status_event WHERE application_id = ?
        ORDER BY changed_at DESC, id DESC LIMIT 1`,
    )
    .get(applicationId) as { statusId: number; changedAt: string } | undefined

  if (!latest) {
    // Timeline emptied. Leave the current status alone — an application always
    // has one — but stop claiming to know when it began.
    db.prepare('UPDATE application SET status_changed_at = NULL WHERE id = ?').run(applicationId)
    return
  }

  // An edit can land the application on a terminal status, which closes out its
  // next step exactly as an ordinary status change would. The fallback is the
  // row's own values, so an edit that reopens an application leaves the next
  // step at "None" — nothing records what it was before it closed.
  const nextStep = closedNextStepSql('next_step_id', 'next_step_date_time')

  db.prepare(
    `UPDATE application
        SET status_changed_at = @changedAt, status_id = @statusId,
            next_step_id = ${nextStep.id},
            next_step_date_time = ${nextStep.dateTime}
      WHERE id = @id`,
  ).run({ id: applicationId, ...latest })
}

export function addEvent(
  userId: number,
  applicationId: number,
  input: { statusId: number; changedAt: string },
): StatusEvent[] | null {
  if (!ownsApplication(userId, applicationId)) return null

  useDatabase()
    .prepare(
      'INSERT INTO status_event (application_id, status_id, changed_at) VALUES (?, ?, ?)',
    )
    .run(applicationId, input.statusId, input.changedAt)

  syncCurrentStatus(applicationId)
  return listHistory(userId, applicationId)
}

export function updateEvent(
  userId: number,
  applicationId: number,
  eventId: number,
  input: { statusId: number; changedAt: string },
): StatusEvent[] | null {
  if (!ownsApplication(userId, applicationId)) return null

  const { changes } = useDatabase()
    .prepare(
      `UPDATE status_event SET status_id = @statusId, changed_at = @changedAt
        WHERE id = @eventId AND application_id = @applicationId`,
    )
    .run({ ...input, eventId, applicationId })

  if (!changes) return null
  syncCurrentStatus(applicationId)
  return listHistory(userId, applicationId)
}

export function deleteEvent(
  userId: number,
  applicationId: number,
  eventId: number,
): StatusEvent[] | null {
  if (!ownsApplication(userId, applicationId)) return null

  const { changes } = useDatabase()
    .prepare('DELETE FROM status_event WHERE id = ? AND application_id = ?')
    .run(eventId, applicationId)

  if (!changes) return null
  syncCurrentStatus(applicationId)
  return listHistory(userId, applicationId)
}
