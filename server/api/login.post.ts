import { z } from 'zod'
import { parseOr400 } from '../utils/validation'
import { useDatabase } from '../database'
import { verifyUserPassword } from '../utils/password'

const Body = z.object({ email: z.string().email(), password: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const { email, password } = parseOr400(Body, await readBody(event))

  const user = useDatabase()
    .prepare('SELECT id, email, password_hash AS passwordHash FROM user WHERE email = ?')
    .get(email) as { id: number; email: string; passwordHash: string } | undefined

  // Same error and roughly the same work either way, so a wrong email and a
  // wrong password are not distinguishable from the outside.
  const ok = user ? await verifyUserPassword(password, user.passwordHash) : false
  if (!user || !ok) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
  }

  await setUserSession(event, { user: { id: user.id, email: user.email } })
  return { ok: true }
})
