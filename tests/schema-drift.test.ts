import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * migrations/ is what actually runs against a database. docs/schema.sql is the
 * readable picture of where those migrations land, and is what the other tests
 * build from.
 *
 * Two sources describing one schema drift apart the moment someone adds a
 * migration and forgets the snapshot. This test makes that failure loud and
 * immediate instead of surfacing weeks later as a mystery.
 */

function build(sql: string): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(sql)
  return db
}

/** Objects SQLite tracks, normalized so incidental whitespace is not a diff. */
function objects(db: Database.Database) {
  return (
    db
      .prepare(
        `SELECT type, name, sql FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%' AND name != 'schema_migration'
         ORDER BY type, name`,
      )
      .all() as { type: string; name: string; sql: string | null }[]
  ).map((r) => ({
    type: r.type,
    name: r.name,
    sql: (r.sql ?? '').replace(/\s+/g, ' ').trim(),
  }))
}

const schemaSql = readFileSync(resolve(process.cwd(), 'docs/schema.sql'), 'utf8')
const migrationSql = readdirSync(resolve(process.cwd(), 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(resolve(process.cwd(), 'migrations', f), 'utf8'))
  .join('\n')

describe('schema.sql and migrations/ agree', () => {
  const fromSchema = build(schemaSql)
  const fromMigrations = build(migrationSql)

  it('define the same set of objects', () => {
    const a = objects(fromSchema).map((o) => `${o.type} ${o.name}`)
    const b = objects(fromMigrations).map((o) => `${o.type} ${o.name}`)
    expect(b).toEqual(a)
  })

  it('define those objects identically', () => {
    expect(objects(fromMigrations)).toEqual(objects(fromSchema))
  })

  it('seed the same status vocabulary', () => {
    const q = 'SELECT label, sort_order, is_terminal FROM status ORDER BY sort_order'
    expect(fromMigrations.prepare(q).all()).toEqual(fromSchema.prepare(q).all())
  })

  it('seed the same next-step and document vocabularies', () => {
    for (const table of ['next_step', 'document_kind']) {
      const q = `SELECT label, sort_order FROM ${table} ORDER BY sort_order`
      expect(fromMigrations.prepare(q).all(), table).toEqual(fromSchema.prepare(q).all())
    }
  })
})

describe('migration files', () => {
  const names = readdirSync(resolve(process.cwd(), 'migrations')).filter((f) => f.endsWith('.sql'))

  it('are numbered, ordered, and gap-free', () => {
    const numbers = names
      .map((n) => {
        const m = /^(\d{4})_/.exec(n)
        expect(m, `${n} must start with a 4-digit prefix, e.g. 0002_add_thing.sql`).not.toBeNull()
        return Number(m![1])
      })
      .sort((a, b) => a - b)

    expect(numbers).toEqual(numbers.map((_, i) => i + 1))
  })

  it('do not set PRAGMAs — those belong on the connection, and journal_mode cannot change mid-transaction', () => {
    for (const n of names) {
      const sql = readFileSync(resolve(process.cwd(), 'migrations', n), 'utf8')
      expect(/^\s*PRAGMA/im.test(sql), n).toBe(false)
    }
  })
})
