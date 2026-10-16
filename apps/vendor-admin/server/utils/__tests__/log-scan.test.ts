import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enrollComplete from '../../api/auth/enroll/complete.post'
import enrollInvitation from '../../api/auth/enroll/invitation.post'
import fallback from '../../api/auth/fallback.post'
import logout from '../../api/auth/logout.post'
import passkeyVerify from '../../api/auth/passkey-verify.post'
import recovery from '../../api/auth/recovery.post'
import session from '../../api/auth/session.get'
import stepUpVerify from '../../api/auth/step-up-verify.post'
import proxy from '../../api/vendor/v1/[...path]'
import { json, send, stubConfig, stubUpstream } from './harness'

// A recognisable secret in every place a request can carry one.
const SECRET = 'LEAKME'
const secretToken = SECRET.repeat(8).slice(0, 43).padEnd(43, 'Z')
const secretSession = `7.${secretToken}`
const secretHeaders = { cookie: `webvue_admin=${secretSession}`, authorization: `Bearer ${SECRET}` }

const requests = [
  () => send(enrollInvitation, '/api/auth/enroll/invitation', { body: { token: secretToken } }),
  () => send(enrollComplete, '/api/auth/enroll/complete', { body: { token: secretToken, password: SECRET, totp_code: '123456', totp_box: 'QUJD' } }),
  () => send(passkeyVerify, '/api/auth/passkey-verify', { body: { challenge_id: 'c'.repeat(36), response: { id: SECRET } } }),
  () => send(fallback, '/api/auth/fallback', { body: { email: `${SECRET}@example.test`, password: SECRET, totp_code: '123456' } }),
  () => send(recovery, '/api/auth/recovery', { body: { email: `${SECRET}@example.test`, password: SECRET, recovery_code: SECRET.padEnd(14, 'a') } }),
  () => send(stepUpVerify, '/api/auth/step-up-verify', { body: { challenge_id: 'c'.repeat(36), response: { id: SECRET } }, headers: secretHeaders }),
  () => send(logout, '/api/auth/logout', { body: {}, headers: secretHeaders }),
  () => send(session, '/api/auth/session', { method: 'GET', headers: secretHeaders }),
  () => send(proxy, '/api/vendor/v1/commercial/plans', { body: { note: SECRET }, headers: secretHeaders }),
  () => send(proxy, `/api/vendor/v1/commercial/plans?q=${SECRET}`, { method: 'GET', headers: secretHeaders }),
]

describe('no secret reaches the logs', () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => undefined))
  beforeEach(() => { stubConfig(); spies.forEach(spy => spy.mockClear()) })
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['an upstream outage echoing the request', () => json(500, { echo: SECRET, detail: secretSession }), true],
    ['a network failure', () => { throw new TypeError(`connect ${SECRET}`) }, true],
    ['an upstream rejection echoing the request', () => json(422, { echo: SECRET }), false],
    ['a malformed upstream answer', () => new Response(`<${SECRET}>`, { status: 200 }), true],
  ])('across every route during %s', async (_name, reply, logsFailures) => {
    stubUpstream(reply as () => Response)
    for (const run of requests) await run()
    const logged = spies.flatMap(spy => spy.mock.calls).map(call => call.map(String).join(' ')).join('\n')
    // The scan must have something to scan: failures are logged by route name and status.
    if (logsFailures) expect(spies.flatMap(spy => spy.mock.calls).length).toBeGreaterThan(0)
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain(secretToken)
  })
})
