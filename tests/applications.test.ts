import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
