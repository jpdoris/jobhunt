import {
  eventDescription,
  eventEnd,
  eventTitle,
  toCalendarStamp,
} from '#shared/calendar'
import { getApplication } from '../../../utils/applications'
import { requireUserId } from '../../../utils/session'

/**
 * A single-event .ics for whatever calendar app the user prefers. Same one-way
 * handoff as the Google link — nothing is read back (docs/PRD.md).
 *
 * RFC 5545 is picky in three ways that hand-rolled generators usually miss, and
 * that Apple Calendar and Outlook both enforce:
 *   - lines end CRLF, not LF
 *   - `\` `;` `,` and newlines inside TEXT values must be escaped
 *   - lines fold at 75 *octets*, not characters
 */

/** Escapes a TEXT value per RFC 5545 §3.3.11. Order matters: backslash first. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Folds to 75 octets, continuing with a leading space. Measured in octets
 * because a multi-byte character split across the boundary corrupts the file —
 * company names carry accents and em dashes.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line

  const out: string[] = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // Never split mid-character: 0b10xxxxxx is a UTF-8 continuation byte.
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--
    out.push(bytes.subarray(start, end).toString('utf8'))
    start = end
    limit = 74 // continuation lines lose one octet to the leading space
  }
  return out.join('\r\n ')
}

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  const application = getApplication(userId, id)
  if (!application) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (!application.nextStepDateTime) {
    throw createError({
      statusCode: 409,
      statusMessage: 'No scheduled next step',
      message: 'Give this application a next step date and time first.',
    })
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace(' ', 'T')

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Job Hunt//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Stable per application, so re-importing updates the event rather than
    // creating a duplicate.
    `UID:application-${application.id}@jobhunt.local`,
    `DTSTAMP:${stamp}Z`,
    `DTSTART:${toCalendarStamp(application.nextStepDateTime)}`,
    `DTEND:${toCalendarStamp(eventEnd(application.nextStepDateTime))}`,
    `SUMMARY:${escapeText(eventTitle(application))}`,
    `DESCRIPTION:${escapeText(eventDescription(application))}`,
    ...(application.jobPostingLink ? [`URL:${escapeText(application.jobPostingLink)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  const body = lines.map(fold).join('\r\n') + '\r\n'
  const filename = `${application.company.replace(/[^\w.\- ]+/g, '_')}.ics`

  setResponseHeaders(event, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  })
  return body
})
