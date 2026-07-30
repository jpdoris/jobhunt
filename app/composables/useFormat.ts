/**
 * Date rendering. The two kinds are deliberately separate — see docs/PRD.md.
 *   applyDate         floating calendar date, never converted
 *   nextStepDateTime  UTC instant, always converted to the viewer's zone
 */

export function formatApplyDate(value: string | null): string {
  return value || '—'
}

export function formatInstant(value: string | null): string {
  if (!value) return '—'
  // SQLite stores "YYYY-MM-DD HH:MM:SS" with no zone marker; tag it as UTC so
  // the browser converts instead of guessing local.
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Local `<input type="datetime-local">` value -> UTC `YYYY-MM-DD HH:MM:SS`. */
export function localInputToUtc(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

/** UTC `YYYY-MM-DD HH:MM:SS` -> value for `<input type="datetime-local">`. */
export function utcToLocalInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}
