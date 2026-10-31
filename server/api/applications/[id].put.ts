import { getApplication, updateApplication } from '../../utils/applications'
import { requireUserId } from '../../utils/session'
import { ApplicationInput, parseOr400 } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  const input = parseOr400(ApplicationInput, await readBody(event))

  // The form shows a terminal status closing out the next step before saving,
  // so updateApplication doing it here is a confirmation rather than a surprise.
  if (!updateApplication(userId, id, input)) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  return getApplication(userId, id)
})
