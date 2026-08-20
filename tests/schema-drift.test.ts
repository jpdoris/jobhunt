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

function master(db: Database.Database) {
  return db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' AND name != 'schema_migration'
       ORDER BY type, name`,
    )
    .all() as { type: string; name: string; sql: string | null }[]
}

/** Names and kinds only — the cheapest check, and the one with the clearest failure. */
function objects(db: Database.Database) {
  return master(db).map((r) => `${r.type} ${r.name}`)
}

/**
 * Column shape per table, straight from SQLite rather than from the DDL text.
 *
 * Comparing raw CREATE TABLE strings looks stricter but is actually useless
 * here: `ALTER TABLE ADD COLUMN` appends to the stored text, so a migrated
 * database never matches an inline definition character-for-character even when
 * the two are identical in every way that matters.
 */
function columns(db: Database.Database) {
  const out: Record<string, unknown[]> = {}
  for (const t of master(db).filter((r) => r.type === 'table')) {
    out[t.name] = db
      .prepare(`PRAGMA table_info("${t.name}")`)
      .all()
      .map((c) => {
        const col = c as { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }
        return `${col.name} ${col.type} notnull=${col.notnull} default=${col.dflt_value ?? '-'} pk=${col.pk}`
      })
  }
  return out
}

/**
 * CHECK constraints as an unordered set per table — table_info does not expose
 * them, and they are load-bearing here (date formats, boolean columns, tone).
 */
function checks(db: Database.Database) {
  const out: Record<string, string[]> = {}
  for (const t of master(db).filter((r) => r.type === 'table')) {
    const sql = (t.sql ?? '').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ')
    out[t.name] = [...sql.matchAll(/CHECK\s*(\([^;]*?\))\s*(?:,|\)\s*$)/gi)]
      .map((m) => m[1]!.replace(/\s+/g, ''))
      .sort()
  }
  return out
}

/** Indexes and triggers are created identically in both, so text is fine there. */
function definitions(db: Database.Database, type: 'index' | 'trigger') {
  return master(db)
    .filter((r) => r.type === type)
    .map((r) => `${r.name}: ${(r.sql ?? '').replace(/\s+/g, ' ').trim()}`)
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
    expect(objects(fromMigrations)).toEqual(objects(fromSchema))
  })

  it('give every table the same columns, types, nullability and defaults', () => {
    expect(columns(fromMigrations)).toEqual(columns(fromSchema))
  })

  it('apply the same CHECK constraints', () => {
    expect(checks(fromMigrations)).toEqual(checks(fromSchema))
  })

  it('define the same indexes', () => {
    expect(definitions(fromMigrations, 'index')).toEqual(definitions(fromSchema, 'index'))
  })

  it('define the same triggers', () => {
    expect(definitions(fromMigrations, 'trigger')).toEqual(definitions(fromSchema, 'trigger'))
  })

  it('seed the same status vocabulary', () => {
    const q = 'SELECT label, sort_order, is_terminal, tone FROM status ORDER BY sort_order'
    expect(fromMigrations.prepare(q).all()).toEqual(fromSchema.prepare(q).all())
  })

  // Only next_step carries this flag, so it sits outside the shared loop below.
  it('flag the same next step as "nothing pending"', () => {
    const q = 'SELECT label FROM next_step WHERE is_none = 1'
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
