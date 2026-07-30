/**
 * Applies docs/schema.sql to the database.
 *
 * docs/schema.sql is the canonical data model (see docs/PRD.md), so it is
 * executed rather than duplicated here. The script is a full create — it
 * refuses to run against a database that already has tables unless --force is
 * passed, which drops everything first.
 *
 *   npm run db:migrate
 *   npm run db:migrate -- --force     # destructive: drops and recreates
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { closeDatabase, databasePath, useDatabase } from '../server/database/index.ts'

const force = process.argv.includes('--force')
const db = useDatabase()

const existing = db
  .prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  )
  .all() as { name: string }[]

if (existing.length && !force) {
  console.error(
    `Database at ${databasePath()} already has ${existing.length} tables.\n` +
      `Re-run with --force to drop and recreate (this deletes all data).`,
  )
  process.exit(1)
}

if (existing.length && force) {
  console.log(`Dropping ${existing.length} existing tables…`)
  db.pragma('foreign_keys = OFF')
  // Views and triggers go with their tables; FTS shadow tables are dropped by
  // dropping the virtual table itself, so filter them out to avoid errors.
  const virtual = new Set(
    (
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name),
  )
  const shadowOf = (n: string) => [...virtual].some((v) => n.startsWith(`${v}_`))
  db.transaction(() => {
    for (const { name } of existing) {
      if (shadowOf(name) && !virtual.has(name)) continue
      db.exec(`DROP TABLE IF EXISTS "${name}"`)
    }
  })()
  db.pragma('foreign_keys = ON')
}

const schema = readFileSync(resolve(process.cwd(), 'docs/schema.sql'), 'utf8')
db.exec(schema)

const tables = db
  .prepare(
    `SELECT count(*) AS n FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  )
  .get() as { n: number }

console.log(`Schema applied to ${databasePath()} — ${tables.n} tables.`)
closeDatabase()
