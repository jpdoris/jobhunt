/**
 * Applies pending migrations from migrations/.
 *
 *   npm run db:migrate            apply anything not yet applied
 *   npm run db:migrate -- --status  list applied / pending, change nothing
 *   npm run db:migrate -- --reset   DESTRUCTIVE: drop everything and re-apply
 *
 * Each file runs in its own transaction, so a failure leaves the database on
 * the last complete migration rather than half-way through one.
 *
 * Applied migrations are checksummed. Editing a file that has already run is a
 * mistake — the databases that ran the old version will never see the edit —
 * so this refuses to continue and tells you to add a new migration instead.
 *
 * docs/schema.sql stays the readable picture of the current schema. It is not
 * executed here; tests/schema-drift.test.ts asserts the two agree.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { closeDatabase, databasePath, useDatabase } from '../server/database/index.ts'

const MIGRATIONS_DIR = resolve(process.cwd(), 'migrations')

const db = useDatabase()
const statusOnly = process.argv.includes('--status')
const reset = process.argv.includes('--reset')

function migrationFiles(): { name: string; sql: string; checksum: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8')
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16) }
    })
}

function ensureLedger(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function userTables(): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migration'`,
      )
      .all() as { name: string }[]
  ).map((r) => r.name)
}

function dropEverything(): void {
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
  // FTS shadow tables vanish with their virtual table; dropping them directly errors.
  const isShadow = (n: string) => !virtual.has(n) && [...virtual].some((v) => n.startsWith(`${v}_`))

  db.pragma('foreign_keys = OFF')
  db.transaction(() => {
    for (const name of [...userTables(), 'schema_migration']) {
      if (isShadow(name)) continue
      db.exec(`DROP TABLE IF EXISTS "${name}"`)
    }
  })()
  db.pragma('foreign_keys = ON')
}

if (reset) {
  console.log('Dropping all tables…')
  dropEverything()
}

ensureLedger()

const files = migrationFiles()
if (!files.length) {
  console.error(`No .sql files in ${MIGRATIONS_DIR}`)
  process.exit(1)
}

const applied = new Map(
  (
    db.prepare('SELECT name, checksum, applied_at FROM schema_migration').all() as {
      name: string
      checksum: string
      applied_at: string
    }[]
  ).map((r) => [r.name, r]),
)

// A database built before migrations existed already has the 0001 schema; running
// it again would fail on "table already exists". Record it as applied instead.
if (!applied.size && userTables().length) {
  const first = files[0]!
  console.log(
    `Existing schema found with no migration ledger.\n` +
      `Baselining: recording ${first.name} as already applied (nothing is executed).`,
  )
  db.prepare('INSERT INTO schema_migration (name, checksum) VALUES (?, ?)').run(
    first.name,
    first.checksum,
  )
  applied.set(first.name, { name: first.name, checksum: first.checksum, applied_at: 'baselined' })
}

// Editing an applied migration silently desynchronizes every other database.
const drifted = files.filter((f) => applied.has(f.name) && applied.get(f.name)!.checksum !== f.checksum)
if (drifted.length) {
  console.error(
    `These migrations changed after being applied:\n` +
      drifted.map((f) => `  ${f.name}`).join('\n') +
      `\n\nDatabases that already ran them will never see the edit. Revert the file\n` +
      `and add a new migration instead.`,
  )
  closeDatabase()
  process.exit(1)
}

const pending = files.filter((f) => !applied.has(f.name))

if (statusOnly) {
  console.log(`Database: ${databasePath()}\n`)
  for (const f of files) {
    const a = applied.get(f.name)
    console.log(`  ${a ? '[applied]' : '[pending]'} ${f.name}${a ? `  ${a.applied_at}` : ''}`)
  }
  closeDatabase()
  process.exit(0)
}

if (!pending.length) {
  console.log(`Up to date — ${applied.size} migration(s) applied.`)
  closeDatabase()
  process.exit(0)
}

for (const f of pending) {
  process.stdout.write(`Applying ${f.name}… `)
  try {
    // exec() cannot run inside better-sqlite3's transaction() wrapper, so drive
    // the transaction explicitly.
    db.exec('BEGIN')
    db.exec(f.sql)
    db.prepare('INSERT INTO schema_migration (name, checksum) VALUES (?, ?)').run(
      f.name,
      f.checksum,
    )
    db.exec('COMMIT')
    console.log('ok')
  } catch (error) {
    db.exec('ROLLBACK')
    console.log('failed')
    console.error(`\n${(error as Error).message}\n\nDatabase left at the previous migration.`)
    closeDatabase()
    process.exit(1)
  }
}

console.log(`\n${pending.length} migration(s) applied to ${databasePath()}.`)
closeDatabase()
