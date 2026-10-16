import { describe, expect, it } from 'vitest'
import { settleSession } from '../sessionGate'

const outage = Object.assign(new Error('unavailable'), { statusCode: 503 })

describe('settleSession', () => {
  it('resolves when the session loads', async () => {
    await expect(settleSession(Promise.resolve(), false)).resolves.toBeUndefined()
  })

  it('lets a failed load reach the error page on a protected page', async () => {
    await expect(settleSession(Promise.reject(outage), false)).rejects.toBe(outage)
  })

  it('renders a public page even when the session load failed', async () => {
    await expect(settleSession(Promise.reject(outage), true)).resolves.toBeUndefined()
  })
})
