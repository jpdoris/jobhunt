import { useDatabase } from '../../database'
import { closedNextStepSql, getApplication } from '../../utils/applications'
import { requireUserId } from '../../utils/session'
import { ApplicationInput, parseOr400 } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const input = parseOr400(ApplicationInput, await readBody(event))

  // Filed as already closed — a rejection logged after the fact — still has no
  // next step, so the same rule applies here as on the way to a terminal status.
  const nextStep = closedNextStepSql('@nextStepId', '@nextStepDateTime')

  const { lastInsertRowid } = useDatabase()
    .prepare(
      `INSERT INTO application (
         user_id, company, role, description, job_posting_link, contact,
         apply_date, status_id, next_step_id, next_step_date_time, notes,
         submitted_to_unemployment, status_changed_at
       ) VALUES (
         @userId, @company, @role, @description, @jobPostingLink, @contact,
         @applyDate, @statusId, ${nextStep.id}, ${nextStep.dateTime}, @notes,
         @submittedToUnemployment, @statusChangedAt
       )`,
    )
    .run({
      userId,
      ...input,
      statusChangedAt: input.statusChangedAt ?? null,
      submittedToUnemployment: Number(input.submittedToUnemployment),
    })

  setResponseStatus(event, 201)
  return getApplication(userId, Number(lastInsertRowid))
})
