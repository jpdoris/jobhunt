import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type DB = Database.Database

let db: DB | null = null

export function databasePath(): string {
  return process.env.JOBHUNT_DB_PATH ?? resolve(process.cwd(), 'data/jobhunt.db')
}

/**
 * Shared connection. better-sqlite3 is synchronous, so one handle per process
 * is both correct and fastest — no pool needed.
 */
export function useDatabase(): DB {
  if (db) return db

  const path = databasePath()
  mkdirSync(dirname(path), { recursive: true })

  db = new Database(path)
  // Enforced per-connection in SQLite, not stored in the file — every process
  // that opens the database has to set it or the FKs silently do nothing.
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  return db
}

export function closeDatabase(): void {
  db?.close()
  db = null
}
