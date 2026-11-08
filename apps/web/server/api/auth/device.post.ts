import { authRefusal, authStep } from './-upstream'

// Finishes a password step with this browser's remembered-device cookie instead of a code. The cookie is
// read by Odoo, never by page code; a device that is gone answers 401 `invalid_device` and is cleared upstream.
export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const answer = await authStep(event, '/api/v1/auth/device', { method: 'POST', build: () => ({}) })
  if (!answer.ok) throw authRefusal(answer.status, answer.body, 'invalid_device')
  return answer.body
})
