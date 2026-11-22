import { describe, expect, it } from 'vitest'
import { SERVICE_COMPONENTS, serviceHealthItemSchema, serviceHealthSchema } from '../commercial/index.js'

const item = { component: 'shared_worker', state: 'ok', since: '2026-11-22T08:00:00Z', last_beat_at: '2026-11-22T09:00:00Z', detail: null }

describe('service health contract', () => {
  it('names the six components the console reports', () => {
    expect([...SERVICE_COMPONENTS]).toEqual(['shared_worker', 'commercial_scheduler', 'payment_adapter', 'mail_adapter', 'alert_channel', 'api_payment_adapter'])
  })
  it('accepts a seen component with or without detail and a component never seen', () => {
    expect(serviceHealthItemSchema.parse(item).state).toBe('ok')
    expect(serviceHealthItemSchema.parse({ ...item, state: 'unavailable', detail: { available: false, code: 'PaymentError' } }).detail).toEqual({ available: false, code: 'PaymentError' })
    expect(serviceHealthItemSchema.parse({ ...item, state: 'never_seen', since: null, last_beat_at: null }).since).toBeNull()
  })
  it('rejects an unknown component or state, an extra field and a bad time', () => {
    expect(() => serviceHealthItemSchema.parse({ ...item, component: 'odoo' })).toThrow()
    expect(() => serviceHealthItemSchema.parse({ ...item, state: 'unknown' })).toThrow()
    expect(() => serviceHealthItemSchema.parse({ ...item, host: 'db.internal' })).toThrow()
    expect(() => serviceHealthItemSchema.parse({ ...item, since: 'yesterday' })).toThrow()
  })
  it('is one entry per component', () => {
    expect(serviceHealthSchema.parse(SERVICE_COMPONENTS.map(component => ({ ...item, component }))).length).toBe(SERVICE_COMPONENTS.length)
    expect(() => serviceHealthSchema.parse([item, item])).toThrow()
  })
})
