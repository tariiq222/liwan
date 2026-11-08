import { LoginVerifySchema } from '@liwan/contracts'
import { createError } from 'h3'
import { authRefusal, authStep } from './-upstream'

// Finishes the pending sign-in with the code (and, optionally, remembers this browser). The answer is the
// /api/v1/me identity plus `remembered`, so the page goes straight to the app without a second round trip.
export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const answer = await authStep(event, '/api/v1/auth/verify', {
    method: 'POST',
    build: (body) => {
      // The shared contract is the one shape; a code of the wrong shape keeps its own machine code, so the page
      // says "six digits" instead of a generic failure. The server trims Arabic-Indic digits it receives.
      const parsed = LoginVerifySchema.safeParse(body)
      if (!parsed.success) {
        throw createError({ statusCode: 422, data: { code: 'invalid_code_format', field: 'code' } })
      }
      return parsed.data
    },
  })
  if (!answer.ok) throw authRefusal(answer.status, answer.body, 'invalid_code')
  return answer.body
})
