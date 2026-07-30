import type { H3Event } from 'h3'

/**
 * Resolves the signed-in user, or throws 401. Every application endpoint must
 * call this and scope its queries by the returned id — see docs/PRD.md.
 */
export async function requireUserId(event: H3Event): Promise<number> {
  const session = await requireUserSession(event)
  const id = (session.user as { id?: number } | undefined)?.id
  if (!id) throw createError({ statusCode: 401, statusMessage: 'Not signed in' })
  return id
}
