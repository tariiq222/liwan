import { describe, expect, it } from 'vitest'
import { messageCanRetry, messageIsFinal, messageStage, parseTemplateVariables, providerHasSenders } from '../integrationMessaging'

describe('messageStage', () => {
  it('splits sent by whether a delivery receipt can still arrive', () => {
    expect(messageStage({ state: 'sent', has_receipt: true })).toBe('sent')
    expect(messageStage({ state: 'sent', has_receipt: false })).toBe('sentNoReceipt')
    expect(messageStage({ state: 'delivered', has_receipt: false })).toBe('delivered')
    expect(messageStage({ state: 'unconfirmed', has_receipt: false })).toBe('unconfirmed')
  })
})

describe('messageIsFinal', () => {
  it('keeps polling a queued message and a sent one that still expects its receipt', () => {
    expect(messageIsFinal({ state: 'queued', has_receipt: false })).toBe(false)
    expect(messageIsFinal({ state: 'sent', has_receipt: true })).toBe(false)
  })
  it('stops on a sent message without a receipt and on every settled state', () => {
    expect(messageIsFinal({ state: 'sent', has_receipt: false })).toBe(true)
    for (const state of ['delivered', 'undelivered', 'failed', 'unconfirmed'] as const) expect(messageIsFinal({ state, has_receipt: true })).toBe(true)
  })
})

describe('messageCanRetry', () => {
  it('allows a retry only for failed and unconfirmed messages', () => {
    expect(['queued', 'sent', 'delivered', 'undelivered', 'failed', 'unconfirmed'].filter(state => messageCanRetry({ state: state as 'failed' }))).toEqual(['failed', 'unconfirmed'])
  })
})

describe('parseTemplateVariables', () => {
  it('reads one key=value per line', () => {
    expect(parseTemplateVariables('1=أحمد\n2 = غدًا=الساعة 5\n')).toEqual({ 1: 'أحمد', 2: 'غدًا=الساعة 5' })
    expect(parseTemplateVariables('')).toEqual({})
  })
  it('refuses a line without a key', () => {
    expect(parseTemplateVariables('قيمة')).toBeNull()
    expect(parseTemplateVariables('=قيمة')).toBeNull()
  })
})

describe('providerHasSenders', () => {
  const provider = (key: string) => ({ code: 'x', auth: 'keys' as const, secrets: [], generated_secrets: [], attributes: [], uses: [{ key, owner: 'o' }], settings_path: null })
  it('is true for a messaging or voice use and false for an application use', () => {
    expect(providerHasSenders(provider('twilio.messaging'))).toBe(true)
    expect(providerHasSenders(provider('twilio.voice'))).toBe(true)
    expect(providerHasSenders(provider('inbox.whatsapp'))).toBe(false)
  })
})
