import { useDatabase } from '../../database'
import { getApplication } from '../../utils/applications'
import { requireUserId } from '../../utils/session'
import { ApplicationInput, parseOr400 } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const input = parseOr400(ApplicationInput, await readBody(event))

  const { lastInsertRowid } = useDatabase()
    .prepare(
      `INSERT INTO application (
         user_id, company, role, description, job_posting_link, contact,
         apply_date, status_id, next_step_id, next_step_date_time, notes,
         submitted_to_unemployment
       ) VALUES (
         @userId, @company, @role, @description, @jobPostingLink, @contact,
         @applyDate, @statusId, @nextStepId, @nextStepDateTime, @notes,
         @submittedToUnemployment
       )`,
    )
    .run({ userId, ...input, submittedToUnemployment: Number(input.submittedToUnemployment) })

  setResponseStatus(event, 201)
  return getApplication(userId, Number(lastInsertRowid))
})
