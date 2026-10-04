import { createApplication, getApplication } from '../../utils/applications'
import { requireUserId } from '../../utils/session'
import { ApplicationInput, parseOr400 } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const input = parseOr400(ApplicationInput, await readBody(event))

  const id = createApplication(userId, input)

  setResponseStatus(event, 201)
  return getApplication(userId, id)
})
