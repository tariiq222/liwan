import { describe, expect, it } from 'vitest'
import {
  IntegrationErrorCodeSchema,
  IntegrationMessageListQuerySchema,
  IntegrationMessageListSchema,
  IntegrationMessageSchema,
  IntegrationMessageStateViewSchema,
  IntegrationMessageTemplateListSchema,
  IntegrationMessagingErrorCodeSchema,
  IntegrationMessagingTestSchema,
} from '../index'

const TEMPLATE = `HX${'b'.repeat(32)}`
// The exact keys of `dump_message_state`, `dump_message` and `dump_template` in
// odoo-addons/liwan_integrations_sa/serializers/message.py.
const STATE = {
  id: 7, channel: 'sms', origin: 'test', state: 'sent', to: '+966501234567', sender_value: '+15005550006', segments: 1,
  error_code: null, error_message: null, has_receipt: true, created_at: '2030-01-15T10:30:00Z',
  sent_at: '2030-01-15T10:31:00Z', read_at: null,
}
const MESSAGE = {
  ...STATE, connection_id: 3, sender_id: 4, provider: 'twilio', account_ref: `AC${'0'.repeat(32)}`, body: 'مرحبا',
  content_sid: null, content_variables: null, requested_by: { id: 2, name: 'Admin' }, provider_message_id: `SM${'1'.repeat(32)}`,
  attempts: 1,
}

describe('message state and log', () => {
  it('accepts the serializer shapes', () => {
    expect(IntegrationMessageStateViewSchema.parse(STATE)).toEqual(STATE)
    expect(Object.keys(STATE).sort()).toEqual([
      'channel', 'created_at', 'error_code', 'error_message', 'has_receipt', 'id', 'origin', 'read_at', 'segments',
      'sender_value', 'sent_at', 'state', 'to',
    ])
    expect(IntegrationMessageSchema.parse(MESSAGE)).toEqual(MESSAGE)
    const template = { ...MESSAGE, id: 8, body: null, content_sid: TEMPLATE, content_variables: { 1: 'سارة' }, connection_id: null, sender_id: null, requested_by: null }
    expect(IntegrationMessageListSchema.parse({ items: [template, MESSAGE], total: 2 }).total).toBe(2)
  })

  it('is strict and knows the states and channels', () => {
    expect(() => IntegrationMessageSchema.parse({ ...MESSAGE, auth_token: 'x' })).toThrow()
    expect(() => IntegrationMessageStateViewSchema.parse({ ...STATE, state: 'read' })).toThrow()
    expect(() => IntegrationMessageStateViewSchema.parse({ ...STATE, channel: 'voice' })).toThrow()
    expect(IntegrationMessageStateViewSchema.parse({ ...STATE, state: 'unconfirmed', error_code: 'interrupted' }).state).toBe('unconfirmed')
  })

  it('validates the log query', () => {
    expect(IntegrationMessageListQuerySchema.parse({ channel: 'whatsapp', state: 'failed', date_from: '2030-01-01', q: '5012' }).channel).toBe('whatsapp')
    expect(() => IntegrationMessageListQuerySchema.parse({ date_from: '01/01/2030' })).toThrow()
  })
})

describe('messaging test and templates', () => {
  it('sends free text or a template with variables', () => {
    expect(IntegrationMessagingTestSchema.parse({ sender_id: 4, to: '0501234567' })).toEqual({ sender_id: 4, to: '0501234567' })
    const template = { sender_id: 4, to: '+966501234567', content_sid: TEMPLATE, content_variables: { 1: 'سارة' } }
    expect(IntegrationMessagingTestSchema.parse(template)).toEqual(template)
    expect(() => IntegrationMessagingTestSchema.parse({ sender_id: 4, to: '+1', content_variables: { 1: 'x' } })).toThrow()
    expect(() => IntegrationMessagingTestSchema.parse({ sender_id: 4, to: '+1', content_sid: 'HX1' })).toThrow()
    expect(() => IntegrationMessagingTestSchema.parse({ sender_id: 4, to: '+1', body: 'x' })).toThrow()
  })

  it('lists templates with their types and variable names', () => {
    const item = { sid: TEMPLATE, name: 'welcome', language: 'ar', types: ['twilio/text'], variables: ['1'] }
    expect(IntegrationMessageTemplateListSchema.parse({ items: [item], total: 1 }).items[0]).toEqual(item)
  })

  it('names the messaging refusals among the integrations error codes', () => {
    for (const code of IntegrationMessagingErrorCodeSchema.options)
      expect(IntegrationErrorCodeSchema.parse(code)).toBe(code)
  })
})
