import { getApplication } from '../../utils/applications'
import { requireUserId } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  // Scoped by userId, so another user's id is indistinguishable from a
  // nonexistent one.
  const application = getApplication(userId, id)
  if (!application) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return application
}) 
