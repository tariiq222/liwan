import { describe, expect, it } from 'vitest'
import {
  IntegrationAvailableNumberListSchema,
  IntegrationCommunicationSettingsSchema,
  IntegrationCommunicationSettingsUpdateSchema,
  IntegrationErrorCodeSchema,
  IntegrationSenderCreateSchema,
  IntegrationSenderListSchema,
  IntegrationSenderSchema,
  IntegrationSenderUpdateSchema,
} from '../index'

// The exact keys of `dump_sender`, `dump_available_number` and `dump_settings` in
// odoo-addons/liwan_integrations_sa/serializers/sender.py.
const SENDER = {
  id: 4, connection_id: 3, provider: 'twilio', channel: 'sms', kind: 'number', value: '+15005550006',
  is_default: true, active: true, created_at: '2030-01-15T10:30:00Z',
}
const NUMBER = { value: '+15005550006', label: '(500) 555-0006', sms: true, voice: false }

describe('IntegrationSenderSchema', () => {
  it('accepts the serializer shape and lists it with a total', () => {
    expect(IntegrationSenderSchema.parse(SENDER)).toEqual(SENDER)
    expect(Object.keys(SENDER).sort()).toEqual(['active', 'channel', 'connection_id', 'created_at', 'id', 'is_default', 'kind', 'provider', 'value'])
    expect(IntegrationSenderListSchema.parse({ items: [SENDER, { ...SENDER, id: 5, channel: 'whatsapp', kind: 'service', value: `MG${'a'.repeat(32)}`, is_default: false }], total: 2 }).total).toBe(2)
  })

  it('is strict and refuses an unknown channel or kind', () => {
    expect(() => IntegrationSenderSchema.parse({ ...SENDER, token: 'x' })).toThrow()
    expect(() => IntegrationSenderSchema.parse({ ...SENDER, channel: 'email' })).toThrow()
    expect(() => IntegrationSenderSchema.parse({ ...SENDER, kind: 'short_code' })).toThrow()
  })
})

describe('sender requests', () => {
  it('creates with the four required fields and an optional default', () => {
    const body = { connection_id: 3, channel: 'sms', kind: 'alphanumeric', value: 'LIWAN' }
    expect(IntegrationSenderCreateSchema.parse(body)).toEqual(body)
    expect(IntegrationSenderCreateSchema.parse({ ...body, is_default: true }).is_default).toBe(true)
    expect(() => IntegrationSenderCreateSchema.parse({ ...body, active: true })).toThrow()
    expect(() => IntegrationSenderCreateSchema.parse({ ...body, value: '' })).toThrow()
  })

  it('patches only is_default and active, and needs one of them', () => {
    expect(IntegrationSenderUpdateSchema.parse({ active: false })).toEqual({ active: false })
    expect(() => IntegrationSenderUpdateSchema.parse({})).toThrow()
    expect(() => IntegrationSenderUpdateSchema.parse({ value: '+15005550006' })).toThrow()
  })
})

describe('available numbers and settings', () => {
  it('lists the account numbers with their capabilities', () => {
    expect(IntegrationAvailableNumberListSchema.parse({ items: [NUMBER], total: 1 }).items[0]).toEqual(NUMBER)
    expect(() => IntegrationAvailableNumberListSchema.parse({ items: [{ ...NUMBER, mms: true }], total: 1 })).toThrow()
  })

  it('bounds the daily message limit', () => {
    expect(IntegrationCommunicationSettingsSchema.parse({ daily_message_limit: 1000 })).toEqual({ daily_message_limit: 1000 })
    for (const value of [0, 100001, 1.5]) expect(() => IntegrationCommunicationSettingsUpdateSchema.parse({ daily_message_limit: value })).toThrow()
  })

  it('names the integrations error codes', () => {
    expect(IntegrationErrorCodeSchema.parse('provider_error')).toBe('provider_error')
    expect(IntegrationErrorCodeSchema.parse('in_use')).toBe('in_use')
  })
})
