import { describe, expect, it } from 'vitest'
import { IntegrationConnectionListSchema, IntegrationConnectionSchema } from '../index'

const CONNECTION = {
  id: 1, kind: 'zatca', provider: 'ZATCA', state: 'not_configured', last_checked: null, status_message: '',
}

describe('IntegrationConnectionSchema', () => {
  it('is strict: it accepts exactly the status fields and never a credential', () => {
    expect(IntegrationConnectionSchema.parse(CONNECTION)).toEqual(CONNECTION)
    expect(Object.keys(IntegrationConnectionSchema.shape).sort()).toEqual(
      ['id', 'kind', 'last_checked', 'provider', 'state', 'status_message'],
    )
    expect(() => IntegrationConnectionSchema.parse({ ...CONNECTION, secret: 'x' })).toThrow()
    expect(() => IntegrationConnectionSchema.parse({ ...CONNECTION, api_key: 'x' })).toThrow()
  })

  it('accepts a check timestamp and every state', () => {
    for (const state of ['not_configured', 'pending', 'connected', 'error']) {
      expect(IntegrationConnectionSchema.parse({ ...CONNECTION, state, last_checked: '2030-01-15T00:00:00Z' }).state).toBe(state)
    }
  })

  it('rejects an unknown kind or state, an empty provider and a non-positive id', () => {
    expect(() => IntegrationConnectionSchema.parse({ ...CONNECTION, kind: 'paypal' })).toThrow()
    expect(() => IntegrationConnectionSchema.parse({ ...CONNECTION, state: 'ok' })).toThrow()
    expect(() => IntegrationConnectionSchema.parse({ ...CONNECTION, provider: '' })).toThrow()
    expect(() => IntegrationConnectionSchema.parse({ ...CONNECTION, id: 0 })).toThrow()
  })
})

describe('IntegrationConnectionListSchema', () => {
  it('wraps connections with a total and rejects extra keys', () => {
    expect(IntegrationConnectionListSchema.parse({ items: [CONNECTION], total: 1 })).toEqual({ items: [CONNECTION], total: 1 })
    expect(IntegrationConnectionListSchema.parse({ items: [], total: 0 }).items).toEqual([])
    expect(() => IntegrationConnectionListSchema.parse({ items: [CONNECTION], total: 1, next: 2 })).toThrow()
    expect(() => IntegrationConnectionListSchema.parse({ items: [CONNECTION], total: -1 })).toThrow()
  })
})
