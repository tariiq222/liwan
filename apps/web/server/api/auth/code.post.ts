import { LoginCodeRequestSchema } from '@liwan/contracts'
import { createError } from 'h3'
import { authRefusal, authStep } from './-upstream'

// Sends one 6-digit code to the pending account over the chosen channel. The answer's `destination` is already
// masked by the server and `resend_after` is the wait it enforces, so the page owns neither.
export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const answer = await authStep(event, '/api/v1/auth/code', {
    method: 'POST',
    build: (body) => {
      // The shared contract is the one shape; an unknown channel is answered with its own machine code so the
      // page never falls back to a generic failure.
      const parsed = LoginCodeRequestSchema.safeParse(body)
      if (!parsed.success) {
        throw createError({ statusCode: 422, data: { code: 'invalid_channel', field: 'channel' } })
      }
      return parsed.data
    },
  })
  if (!answer.ok) throw authRefusal(answer.status, answer.body, 'channel_unavailable')
  return answer.body
})
