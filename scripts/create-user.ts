/**
 * Creates a user account, or resets an existing account's password.
 * Account creation is CLI-only by design — there is no signup page and no
 * self-registration endpoint (docs/PRD.md).
 *
 *   npm run user:create you@example.com     create; fails if the email exists
 *   npm run user:reset  you@example.com     reset an existing password
 *
 * The email is positional so neither form needs npm's `--` separator. Flags
 * still do:
 *
 *   npm run user:create -- you@example.com --password secret
 *   npm run user:reset  -- you@example.com --yes        (skip confirmation)
 *
 * Omit --password to be prompted; input is hidden.
 *
 * Resetting never asks for the old password. Anyone who can run this already
 * has write access to data/jobhunt.db and could rewrite the hash directly, so
 * the check would buy nothing while breaking the forgotten-password case it
 * exists for. The guard here is against the real hazard: a mistyped email
 * silently locking somebody out.
 */
import { createInterface } from 'node:readline'
import { hashUserPassword } from '../server/utils/password.ts'
import { closeDatabase, useDatabase } from '../server/database/index.ts'

const argv = process.argv.slice(2)

function flag(name: string): boolean {
  return argv.includes(`--${name}`)
}

function option(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

/** First bare word, so `npm run user:create you@example.com` needs no `--`. */
function positional(): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i]!
    if (value.startsWith('--')) {
      // Skip this flag's value when it takes one.
      if (['email', 'password'].includes(value.slice(2))) i++
      continue
    }
    return value
  }
  return undefined
}

function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(false)
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

/**
 * Reads a password without echoing it.
 *
 * readline can't do this cleanly — muting its output still lets its line-refresh
 * escape codes through — so on a TTY we read raw keystrokes instead. When stdin
 * is a pipe there is no echo to suppress, so just read the line.
 */
function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process

  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: stdin })
      rl.once('line', (line) => {
        rl.close()
        resolve(line)
      })
    })
  }

  return new Promise((resolve, reject) => {
    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let value = ''

    const done = (finish: () => void) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      stdout.write('\n')
      finish()
    }

    function onData(chunk: string) {
      for (const char of chunk) {
        switch (char) {
          case '\n':
          case '\r':
          case '': // Ctrl-D
            return done(() => resolve(value))
          case '': // Ctrl-C
            return done(() => reject(new Error('Cancelled')))
          case '': // Backspace
          case '\b':
            value = value.slice(0, -1)
            break
          default:
            // Ignore other control characters (arrow keys arrive as escapes).
            if (char >= ' ') value += char
        }
      }
    }

    stdin.on('data', onData)
  })
}

const email = positional() ?? option('email')
const resetting = flag('reset')

if (!email) {
  console.error(
    'Usage:\n' +
      '  npm run user:create you@example.com          create a new account\n' +
      '  npm run user:reset  you@example.com          reset an existing password\n\n' +
      'Flags need npm\'s separator:\n' +
      '  npm run user:create -- you@example.com --password secret\n' +
      '  npm run user:reset  -- you@example.com --yes',
  )
  process.exit(1)
}

const db = useDatabase()

const existing = db.prepare('SELECT id FROM user WHERE email = ?').get(email) as
  | { id: number }
  | undefined

// Creating and resetting are separate intents. Conflating them is how a typo
// silently overwrites a real account's password.
if (existing && !resetting) {
  console.error(
    `${email} already exists (id ${existing.id}).\n` +
      `To change their password:  npm run user:reset ${email}`,
  )
  closeDatabase()
  process.exit(1)
}

if (!existing && resetting) {
  console.error(
    `No account with email ${email}. Check the spelling, or create it:\n` +
      `  npm run user:create ${email}`,
  )
  closeDatabase()
  process.exit(1)
}

if (existing && resetting && !flag('yes')) {
  const ok = await confirm(`Reset the password for ${email} (id ${existing.id})? [y/N] `)
  if (!ok) {
    console.error(
      process.stdin.isTTY
        ? 'Cancelled.'
        : 'Refusing to reset without confirmation. Pass --yes for non-interactive use.',
    )
    closeDatabase()
    process.exit(1)
  }
}

const password = option('password') ?? (await promptHidden('New password: '))
if (password.length < 8) {
  console.error('Password must be at least 8 characters.')
  closeDatabase()
  process.exit(1)
}

if (existing) {
  db.prepare('UPDATE user SET password_hash = ? WHERE id = ?').run(
    await hashUserPassword(password),
    existing.id,
  )
  console.log(`Reset password for ${email}.`)
} else {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO user (email, password_hash) VALUES (?, ?)')
    .run(email, await hashUserPassword(password))
  console.log(`Created user ${email} (id ${lastInsertRowid}).`)
}

closeDatabase()
