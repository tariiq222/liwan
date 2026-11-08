import { authRefusal, authStep } from './-upstream'

// The account holder forgets their remembered browsers; the one they are using keeps working, so a single
// device is never signed out of its own convenience. Answers the ids that are still remembered. Like the
// password step, it carries no payload: the browser's own session cookie is the whole request.
export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const answer = await authStep(event, '/api/v1/auth/device', { method: 'DELETE', scope: 'session' })
  if (!answer.ok) throw authRefusal(answer.status, answer.body, 'forbidden')
  return answer.body
})
