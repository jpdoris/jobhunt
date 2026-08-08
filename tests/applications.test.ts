import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MILESTONE_SQL } from '../server/utils/applications'
import { MILESTONES } from '../shared/types'
import type { Milestone } from '../shared/types'

/**
 * Exercises the schema directly rather than through the HTTP layer: the rules
 * being protected (user scoping, trigger-maintained history, read-only
 * vocabularies) are enforced in SQL, so that is where they are worth testing.
 */

let db: Database.Database
let ownerId: number
let otherId: number
let statusApplied: number
let statusInterview: number
let statusInterviewed: number
let statusRejected: number
let statusOffer: number
let statusDeclined: number
let statusExpired: number
let nextAwaiting: number

beforeAll(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(resolve(process.cwd(), 'docs/schema.sql'), 'utf8'))

  ownerId = Number(
    db.prepare('INSERT INTO user (email, password_hash) VALUES (?, ?)').run('owner@test', 'x')
      .lastInsertRowid,
  )
  otherId = Number(
    db.prepare('INSERT INTO user (email, password_hash) VALUES (?, ?)').run('other@test', 'x')
      .lastInsertRowid,
  )

  const id = (label: string) =>
    (db.prepare('SELECT id FROM status WHERE label = ?').get(label) as { id: number }).id
  statusApplied = id('Applied')
  statusInterview = id('Interview scheduled')
  statusInterviewed = id('Interviewed (round 1)')
  statusRejected = id('Rejected')
  statusOffer = id('Offer received')
  statusDeclined = id('Offer declined')
  statusExpired = id('Expired / Not pursued')
  nextAwaiting = (
    db.prepare('SELECT id FROM next_step WHERE label = ?').get('Awaiting response') as {
      id: number
    }
  ).id
})

afterAll(() => db.close())

function insert(userId: number, company: string) {
  return Number(
    db
      .prepare(
        `INSERT INTO application (user_id, company, status_id, next_step_id)
         VALUES (?, ?, ?, ?)`,
      )
      .run(userId, company, statusApplied, nextAwaiting).lastInsertRowid,
  )
}

describe('user scoping', () => {
  it('never returns another user\'s rows', () => {
    insert(ownerId, 'Owner Co')
    insert(otherId, 'Other Co')

    const owned = db
      .prepare('SELECT company FROM application WHERE user_id = ?')
      .all(ownerId) as { company: string }[]

    expect(owned.map((r) => r.company)).toEqual(['Owner Co'])
  })

  it('scoped update cannot touch another user\'s row', () => {
    const victim = insert(ownerId, 'Victim Co')
    const { changes } = db
      .prepare('UPDATE application SET company = ? WHERE id = ? AND user_id = ?')
      .run('PWNED', victim, otherId)

    expect(changes).toBe(0)
    const row = db.prepare('SELECT company FROM application WHERE id = ?').get(victim) as {
      company: string
    }
    expect(row.company).toBe('Victim Co')
  })

  it('deleting a user cascades to their applications', () => {
    const temp = Number(
      db.prepare('INSERT INTO user (email, password_hash) VALUES (?, ?)').run('temp@test', 'x')
        .lastInsertRowid,
    )
    insert(temp, 'Temp Co')
    db.prepare('DELETE FROM user WHERE id = ?').run(temp)

    const left = db.prepare('SELECT count(*) AS n FROM application WHERE user_id = ?').get(temp) as {
      n: number
    }
    expect(left.n).toBe(0)
  })
})

describe('status history', () => {
  it('records one event on insert', () => {
    const id = insert(ownerId, 'History Co')
    const events = db
      .prepare('SELECT count(*) AS n FROM status_event WHERE application_id = ?')
      .get(id) as { n: number }
    expect(events.n).toBe(1)
  })

  it('appends an event when the status changes', () => {
    const id = insert(ownerId, 'Moves Co')
    db.prepare('UPDATE application SET status_id = ? WHERE id = ?').run(statusInterview, id)

    const labels = (
      db
        .prepare(
          `SELECT s.label FROM status_event e
           JOIN status s ON s.id = e.status_id
           WHERE e.application_id = ? ORDER BY e.id`,
        )
        .all(id) as { label: string }[]
    ).map((r) => r.label)

    expect(labels).toEqual(['Applied', 'Interview scheduled'])
  })

  it('does not record an event when a non-status column changes', () => {
    const id = insert(ownerId, 'Quiet Co')
    db.prepare('UPDATE application SET notes = ? WHERE id = ?').run('touched', id)

    const events = db
      .prepare('SELECT count(*) AS n FROM status_event WHERE application_id = ?')
      .get(id) as { n: number }
    expect(events.n).toBe(1)
  })

  it('does not record an event when the status is set to its current value', () => {
    const id = insert(ownerId, 'Noop Co')
    db.prepare('UPDATE application SET status_id = ? WHERE id = ?').run(statusApplied, id)

    const events = db
      .prepare('SELECT count(*) AS n FROM status_event WHERE application_id = ?')
      .get(id) as { n: number }
    expect(events.n).toBe(1)
  })
})

describe('vocabularies', () => {
  it('refuses to delete a status that applications reference', () => {
    insert(ownerId, 'Referencing Co')
    expect(() => db.prepare('DELETE FROM status WHERE id = ?').run(statusApplied)).toThrow(
      /FOREIGN KEY/i,
    )
  })

  it('rejects an application pointing at a nonexistent status', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO application (user_id, company, status_id, next_step_id)
           VALUES (?, ?, ?, ?)`,
        )
        .run(ownerId, 'Bad Co', 9999, nextAwaiting),
    ).toThrow(/FOREIGN KEY/i)
  })
})

describe('date and time constraints', () => {
  const cases: [string, boolean][] = [
    ['2026-08-05 14:30:00', true],
    ['2026-08-05 00:00:00', true],
    ['2026-08-05 23:59:59', true],
    ['2026-08-05', false],
    ['2026-08-05 24:00:00', false],
    ['2026-08-05 25:00:00', false],
    ['2026-08-05 14:60:00', false],
    ['not a date', false],
  ]

  it.each(cases)('next_step_date_time %s accepted=%s', (value, allowed) => {
    const id = insert(ownerId, `DT ${value}`)
    const run = () =>
      db.prepare('UPDATE application SET next_step_date_time = ? WHERE id = ?').run(value, id)

    if (allowed) expect(run).not.toThrow()
    else expect(run).toThrow(/CHECK/i)
  })

  it('rejects a malformed apply_date', () => {
    const id = insert(ownerId, 'Bad Date Co')
    expect(() =>
      db.prepare('UPDATE application SET apply_date = ? WHERE id = ?').run('07/30/2026', id),
    ).toThrow(/CHECK/i)
  })
})

describe('full-text search', () => {
  it('finds applications by description text', () => {
    const id = insert(ownerId, 'Searchable Co')
    db.prepare('UPDATE application SET description = ? WHERE id = ?').run(
      'Senior frontend engineer working on design systems in Vue',
      id,
    )

    const hits = db
      .prepare(
        `SELECT a.company FROM application_fts f
         JOIN application a ON a.id = f.rowid
         WHERE application_fts MATCH ? AND a.user_id = ?`,
      )
      .all('"design"* AND "systems"*', ownerId) as { company: string }[]

    expect(hits.map((h) => h.company)).toContain('Searchable Co')
  })

  it('drops a deleted application out of the index', () => {
    const id = insert(ownerId, 'Ephemeral Co')
    db.prepare('UPDATE application SET description = ? WHERE id = ?').run('quokka', id)
    db.prepare('DELETE FROM application WHERE id = ?').run(id)

    const hits = db
      .prepare('SELECT rowid FROM application_fts WHERE application_fts MATCH ?')
      .all('"quokka"*')

    expect(hits).toHaveLength(0)
  })
})

describe('backdated history', () => {
  it('records the supplied time instead of now', () => {
    const id = insert(ownerId, 'Backdate Co')
    db.prepare(
      'UPDATE application SET status_changed_at = ?, status_id = ? WHERE id = ?',
    ).run('2026-03-02 12:00:00', statusInterview, id)

    const when = db
      .prepare('SELECT changed_at FROM status_event WHERE application_id = ? ORDER BY id DESC LIMIT 1')
      .get(id) as { changed_at: string }
    expect(when.changed_at).toBe('2026-03-02 12:00:00')
  })

  it('falls back to now when no time is supplied', () => {
    const id = insert(ownerId, 'Now Co')
    db.prepare('UPDATE application SET status_id = ? WHERE id = ?').run(statusInterview, id)

    const when = db
      .prepare('SELECT changed_at FROM status_event WHERE application_id = ? ORDER BY id DESC LIMIT 1')
      .get(id) as { changed_at: string }
    // Same shape as the CHECK constraint, and not the backdated value.
    expect(when.changed_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(when.changed_at.startsWith('2026-03-02')).toBe(false)
  })

  it('rejects a malformed status_changed_at', () => {
    const id = insert(ownerId, 'Bad Time Co')
    expect(() =>
      db.prepare('UPDATE application SET status_changed_at = ? WHERE id = ?').run('2026-03-02', id),
    ).toThrow(/CHECK/i)
  })

  /**
   * Re-syncing after a history edit writes status_id back to the application.
   * Without the trigger's NOT EXISTS guard that write appends a duplicate of the
   * very event it came from, and every duration metric inherits the error.
   */
  it('does not duplicate an event when the winning status is written back', () => {
    const id = insert(ownerId, 'Sync Co')
    db.prepare('UPDATE application SET status_changed_at = ?, status_id = ? WHERE id = ?')
      .run('2026-04-01 09:00:00', statusInterview, id)
    const before = db
      .prepare('SELECT count(*) AS n FROM status_event WHERE application_id = ?')
      .get(id) as { n: number }

    // Simulate syncCurrentStatus() pointing at the latest event again.
    db.prepare('UPDATE application SET status_changed_at = ?, status_id = ? WHERE id = ?')
      .run('2026-04-01 09:00:00', statusInterview, id)

    const after = db
      .prepare('SELECT count(*) AS n FROM status_event WHERE application_id = ?')
      .get(id) as { n: number }
    expect(after.n).toBe(before.n)
  })

  it('still records a genuine change at the same timestamp as a different status', () => {
    const id = insert(ownerId, 'Distinct Co')
    db.prepare('UPDATE application SET status_changed_at = ?, status_id = ? WHERE id = ?')
      .run('2026-05-01 09:00:00', statusInterview, id)
    db.prepare('UPDATE application SET status_changed_at = ?, status_id = ? WHERE id = ?')
      .run('2026-05-01 09:00:00', statusApplied, id)

    const labels = (
      db
        .prepare(
          `SELECT s.label FROM status_event e JOIN status s ON s.id = e.status_id
           WHERE e.application_id = ? ORDER BY e.id`,
        )
        .all(id) as { label: string }[]
    ).map((r) => r.label)
    expect(labels).toEqual(['Applied', 'Interview scheduled', 'Applied'])
  })
})

/**
 * The list filters and the analytics tile share MILESTONE_SQL, so this covers
 * both. Run against the real fragments rather than copies — a divergent copy
 * would pass while the app disagreed with itself.
 */
describe('milestone predicates', () => {
  const hits = (milestone: Milestone, id: number) =>
    Boolean(
      (
        db
          .prepare(
            `SELECT ${MILESTONE_SQL[milestone]} AS hit FROM application a
             JOIN status s ON s.id = a.status_id WHERE a.id = ?`,
          )
          .get(id) as { hit: number }
      ).hit,
    )

  /** Walks an application through statuses, leaving real history behind. */
  const walk = (company: string, ...path: number[]) => {
    const id = insert(ownerId, company)
    for (const status of path) {
      db.prepare('UPDATE application SET status_id = ? WHERE id = ?').run(status, id)
    }
    return id
  }

  it('every milestone has SQL', () => {
    expect(Object.keys(MILESTONE_SQL).sort()).toEqual([...MILESTONES].sort())
  })

  describe('interviewed', () => {
    it('is false for an application that never moved past Applied', () => {
      expect(hits('interviewed', walk('Never Co'))).toBe(false)
    })

    it('is false for a scheduled but not yet completed interview', () => {
      expect(hits('interviewed', walk('Booked Co', statusInterview))).toBe(false)
    })

    it('is true at an interviewed status', () => {
      expect(hits('interviewed', walk('Sat Down Co', statusInterviewed))).toBe(true)
    })

    it('stays true after the application ends in rejection', () => {
      expect(hits('interviewed', walk('Then Rejected Co', statusInterviewed, statusRejected))).toBe(
        true,
      )
    })

    // The imported rows are exactly this shape: a current status and no events.
    it('is true from the current status alone when there is no history', () => {
      const id = walk('No History Co', statusInterviewed)
      db.prepare('DELETE FROM status_event WHERE application_id = ?').run(id)
      expect(hits('interviewed', id)).toBe(true)
    })
  })

  describe('offered', () => {
    it('is false when no offer was ever made', () => {
      expect(hits('offered', walk('No Offer Co', statusInterviewed, statusRejected))).toBe(false)
    })

    it('is true at Offer received', () => {
      expect(hits('offered', walk('Got One Co', statusOffer))).toBe(true)
    })

    // The whole reason is_offer exists rather than reusing is_terminal.
    it('is true at Offer declined — you can only decline one you were given', () => {
      expect(hits('offered', walk('Declined Co', statusDeclined))).toBe(true)
    })

    it('is true when the offer is only in history', () => {
      expect(hits('offered', walk('Lapsed Co', statusOffer, statusExpired))).toBe(true)
    })
  })

  describe('open', () => {
    it('is true for a live application', () => {
      expect(hits('open', walk('Live Co'))).toBe(true)
    })

    it('is false once it reaches a terminal status', () => {
      expect(hits('open', walk('Done Co', statusRejected))).toBe(false)
    })

    // Offer received is deliberately non-terminal: it is still in play.
    it('is true at Offer received', () => {
      expect(hits('open', walk('Deciding Co', statusOffer))).toBe(true)
    })
  })

  describe('closedNoOffer', () => {
    it('is true for a plain rejection', () => {
      expect(hits('closedNoOffer', walk('Rejected Co', statusRejected))).toBe(true)
    })

    it('is false while the application is still open', () => {
      expect(hits('closedNoOffer', walk('Still Going Co', statusInterviewed))).toBe(false)
    })

    it('is false at Offer declined', () => {
      expect(hits('closedNoOffer', walk('Turned Down Co', statusDeclined))).toBe(false)
    })

    // Closed at a no-offer status, but an offer did happen — the case that
    // makes this more than `is_terminal = 1 AND status is not an offer`.
    it('is false when an offer appears only in history', () => {
      expect(hits('closedNoOffer', walk('Offer Then Lapsed Co', statusOffer, statusExpired))).toBe(
        false,
      )
    })
  })
})
