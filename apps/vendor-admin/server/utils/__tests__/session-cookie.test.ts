import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { clearSession, readSession, writeSession } from '../session-cookie'
import { SESSION, stubConfig } from './harness'

async function run(adminOrigin: string, action: (event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]) => unknown, cookie?: string) {
  stubConfig({ adminOrigin, trustProxy: true })
  const app = createApp()
  app.use(defineEventHandler(async (event) => {
    try { return { result: await action(event) ?? null } } catch { return { result: 'threw' } }
  }))
  const response = await toWebHandler(app)(new Request(`${adminOrigin}/`, { headers: cookie ? { cookie } : {} }))
  return { setCookie: response.headers.get('set-cookie'), body: await response.json() as { result: unknown } }
}

describe('session cookie', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T00:00:00Z')) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('uses the __Host- name with Secure on an https origin', async () => {
    const { setCookie } = await run('https://admin.nasq.sa', event => writeSession(event, SESSION, '2026-10-16T01:00:00Z'))
    expect(setCookie).toContain(`__Host-nasq_admin=${SESSION}`)
    expect(setCookie).toMatch(/Max-Age=3600/)
    for (const attribute of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict']) expect(setCookie).toContain(attribute)
    expect(setCookie).not.toMatch(/Domain=/i)
  })

  it('uses the plain name without Secure on a loopback http origin', async () => {
    const { setCookie } = await run('http://localhost:3100', event => writeSession(event, SESSION, '2026-10-16T00:10:00Z'))
    expect(setCookie).toContain(`nasq_admin=${SESSION}`)
    expect(setCookie).not.toContain('__Host-')
    expect(setCookie).not.toContain('Secure')
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/Max-Age=600/)
  })

  it('never lets Max-Age go negative', async () => {
    const { setCookie } = await run('http://localhost:3100', event => writeSession(event, SESSION, '2026-10-15T00:00:00Z'))
    expect(setCookie).toMatch(/Max-Age=0/)
  })

  it('refuses a malformed session string or expiry', async () => {
    for (const [session, expires] of [['bad', '2026-10-16T01:00:00Z'], [SESSION, 'tomorrow'], [`0.${'A'.repeat(43)}`, '2026-10-16T01:00:00Z']]) {
      const { body } = await run('http://localhost:3100', event => writeSession(event, session, expires))
      expect(body.result).toBe('threw')
    }
  })

  it('reads a well-formed cookie and the account id inside it', async () => {
    const { body } = await run('http://localhost:3100', readSession, `nasq_admin=${SESSION}`)
    expect(body.result).toEqual({ accountId: 7, value: SESSION })
  })

  it('rejects malformed values and the wrong cookie name', async () => {
    for (const cookie of ['nasq_admin=garbage', `nasq_admin=7.${'A'.repeat(42)}`, `nasq_admin=a.${'A'.repeat(43)}`, `nasq_admin=99999999999999999.${'A'.repeat(43)}`, `__Host-nasq_admin=${SESSION}`]) {
      expect((await run('http://localhost:3100', readSession, cookie)).body.result, cookie).toBeNull()
    }
  })

  it('clears with the same attributes', async () => {
    const { setCookie } = await run('https://admin.nasq.sa', clearSession)
    expect(setCookie).toContain('__Host-nasq_admin=;')
    expect(setCookie).toMatch(/Max-Age=0/)
    expect(setCookie).toContain('Secure')
  })
})
