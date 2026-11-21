import { describe, expect, it } from 'vitest'
import {
  IntegrationCallListQuerySchema,
  IntegrationCallListSchema,
  IntegrationCallSchema,
  IntegrationCallStateViewSchema,
  IntegrationErrorCodeSchema,
  IntegrationLookupErrorCodeSchema,
  IntegrationLookupResultSchema,
  IntegrationLookupTestSchema,
  IntegrationVoiceErrorCodeSchema,
  IntegrationVoiceTestSchema,
} from '../index'

// The exact keys of `dump_call_state` and `dump_call` in
// odoo-addons/liwan_integrations_sa/serializers/call.py.
const STATE = {
  id: 9, mode: 'speak', origin: 'test', state: 'completed', to: '+966501234567', from_value: '+15005550007',
  duration_seconds: 42, recorded: false, error_code: null, error_message: null,
  created_at: '2030-01-15T10:30:00Z', started_at: '2030-01-15T10:30:05Z', ended_at: '2030-01-15T10:30:47Z',
}
const CALL = {
  ...STATE, connection_id: 3, sender_id: 4, provider: 'twilio', account_ref: `AC${'0'.repeat(32)}`,
  speak_text: 'مرحبًا', bridge_to: null, requested_by: { id: 2, name: 'Admin' },
  provider_call_id: `CA${'1'.repeat(32)}`, recording_ref: `RE${'2'.repeat(32)}`, recording_duration_seconds: 40,
}

describe('call state and log', () => {
  it('accepts the serializer shapes', () => {
    expect(IntegrationCallStateViewSchema.parse(STATE)).toEqual(STATE)
    expect(Object.keys(STATE).sort()).toEqual([
      'created_at', 'duration_seconds', 'ended_at', 'error_code', 'error_message', 'from_value', 'id', 'mode',
      'origin', 'recorded', 'started_at', 'state', 'to',
    ])
    expect(IntegrationCallSchema.parse(CALL)).toEqual(CALL)
    expect(IntegrationCallListSchema.parse({ items: [CALL], total: 1 }).total).toBe(1)
  })

  it('is strict and knows the call states', () => {
    expect(() => IntegrationCallSchema.parse({ ...CALL, auth_token: 'x' })).toThrow()
    expect(() => IntegrationCallStateViewSchema.parse({ ...STATE, state: 'queued' })).toThrow()
    expect(IntegrationCallStateViewSchema.parse({ ...STATE, duration_seconds: null }).duration_seconds).toBeNull()
    expect(IntegrationCallStateViewSchema.parse({ ...STATE, state: 'unconfirmed', error_code: 'unconfirmed' }).state).toBe('unconfirmed')
  })

  it('validates the log query', () => {
    expect(IntegrationCallListQuerySchema.parse({ state: 'no_answer', date_from: '2030-01-01', q: '5012' }).state).toBe('no_answer')
    expect(() => IntegrationCallListQuerySchema.parse({ date_from: '01/01/2030' })).toThrow()
  })
})

describe('voice test and lookup', () => {
  it('sends a speak test with a text or the fixed Arabic sentence', () => {
    expect(IntegrationVoiceTestSchema.parse({ to: '0501234567', mode: 'speak' })).toEqual({ to: '0501234567', mode: 'speak' })
    const with_text = { to: '+966501234567', mode: 'speak', text: 'مرحبًا، هذه مكالمة تجريبية من ليوان.', language: 'ar-AE' as const, sender_id: 4 }
    expect(IntegrationVoiceTestSchema.parse(with_text).language).toBe('ar-AE')
    expect(() => IntegrationVoiceTestSchema.parse({ to: '+1', mode: 'speak', text: 'ب'.repeat(501) })).toThrow()
    expect(() => IntegrationVoiceTestSchema.parse({ to: '+1', mode: 'speak', language: 'fr' })).toThrow()
    expect(() => IntegrationVoiceTestSchema.parse({ to: '+1', mode: 'hangup' })).toThrow()
  })

  it('sends a bridge test with an agent number', () => {
    const body = { to: '+966501234567', mode: 'bridge' as const, agent_number: '+15005550007' }
    expect(IntegrationVoiceTestSchema.parse(body)).toEqual(body)
    expect(() => IntegrationVoiceTestSchema.parse({ ...body, text: 'مرحبًا' })).toThrow()
  })

  it('asks the lookup with an optional line type and reads the answer', () => {
    expect(IntegrationLookupTestSchema.parse({ number: '0501234567' })).toEqual({ number: '0501234567' })
    expect(IntegrationLookupTestSchema.parse({ number: '+966501234567', line_type: true }).line_type).toBe(true)
    expect(() => IntegrationLookupTestSchema.parse({ number: '+1', line_type: 'mobile' })).toThrow()
    const answer = { valid: true, e164: '+966501234567', country: 'SA', line_type: 'mobile' }
    expect(IntegrationLookupResultSchema.parse(answer)).toEqual(answer)
    expect(IntegrationLookupResultSchema.parse({ ...answer, line_type: null }).line_type).toBeNull()
    expect(() => IntegrationLookupResultSchema.parse({ ...answer, carrier: 'STC' })).toThrow()
  })

  it('names the voice and lookup refusals among the integrations error codes', () => {
    for (const code of IntegrationVoiceErrorCodeSchema.options)
      expect(IntegrationErrorCodeSchema.parse(code)).toBe(code)
    for (const code of IntegrationLookupErrorCodeSchema.options)
      expect(IntegrationErrorCodeSchema.parse(code)).toBe(code)
  })
})
