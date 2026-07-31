import type { Application } from './types'

/**
 * One-way handoff to a calendar app. No OAuth, no tokens, nothing read back —
 * see docs/PRD.md. The user confirms the event in their own calendar UI.
 */

/**
 * We store a start but no duration, so the event needs an assumed length.
 * An hour covers a screener or an interview round without the user having to
 * trim it; they can adjust before saving either way.
 */
export const DEFAULT_EVENT_MINUTES = 60

/** `YYYYMMDDTHHMMSSZ` — the basic-format UTC stamp both Google and iCalendar want. */
export function toCalendarStamp(utcInstant: string): string {
  return `${utcInstant.replace(/[-:]/g, '').replace(' ', 'T')}Z`
}

export function eventEnd(utcInstant: string, minutes = DEFAULT_EVENT_MINUTES): string {
  const end = new Date(`${utcInstant.replace(' ', 'T')}Z`)
  end.setMinutes(end.getMinutes() + minutes)
  return end.toISOString().slice(0, 19).replace('T', ' ')
}

export function eventTitle(a: Application): string {
  // "None" is a real next-step value, and reads as nonsense in a calendar.
  const step = a.nextStepLabel && a.nextStepLabel !== 'None' ? a.nextStepLabel : null
  return step ? `${step} — ${a.company}` : `${a.company}${a.role ? ` — ${a.role}` : ''}`
}

export function eventDescription(a: Application): string {
  return [
    a.role ? `Role: ${a.role}` : null,
    `Status: ${a.statusLabel}`,
    a.nextStepLabel !== 'None' ? `Next step: ${a.nextStepLabel}` : null,
    a.contact ? `Contact: ${a.contact}` : null,
    a.jobPostingLink ? `Posting: ${a.jobPostingLink}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Google Calendar's event composer. Every value is URL-encoded by
 * URLSearchParams; the origin is a literal, never built from user data.
 */
export function googleCalendarUrl(a: Application): string | null {
  if (!a.nextStepDateTime) return null

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventTitle(a),
    dates: `${toCalendarStamp(a.nextStepDateTime)}/${toCalendarStamp(eventEnd(a.nextStepDateTime))}`,
    details: eventDescription(a),
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
