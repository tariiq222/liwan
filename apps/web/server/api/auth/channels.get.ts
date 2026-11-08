import { authRefusal, authStep } from './-upstream'

// What a pending sign-in may use: SMS only when the tenant has a provider configured, email always.
export default defineEventHandler(async (event) => {
  const answer = await authStep(event, '/api/v1/auth/channels', { method: 'GET' })
  if (!answer.ok) throw authRefusal(answer.status, answer.body, 'no_pending_login')
  return answer.body
})
