import { describe, expect, it } from 'vitest'
import { callDuration, callIsFinal, providerHasVoice } from '../integrationVoice'

describe('callIsFinal', () => {
  it('keeps polling a call while it rings or is live', () => {
    for (const state of ['initiated', 'ringing', 'in_progress'] as const) expect(callIsFinal({ state })).toBe(false)
  })
  it('stops on every settled state, including unconfirmed', () => {
    for (const state of ['completed', 'busy', 'no_answer', 'failed', 'canceled', 'unconfirmed'] as const) expect(callIsFinal({ state })).toBe(true)
  })
})

describe('callDuration', () => {
  it('formats a length as m:ss and gives null while the call has not ended', () => {
    expect(callDuration(null)).toBeNull()
    expect(callDuration(0)).toBe('0:00')
    expect(callDuration(51)).toBe('0:51')
    expect(callDuration(140)).toBe('2:20')
    expect(callDuration(3600)).toBe('60:00')
  })
})

describe('providerHasVoice', () => {
  const provider = (key: string) => ({ code: 'x', auth: 'keys' as const, secrets: [], generated_secrets: [], attributes: [], uses: [{ key, owner: 'o' }], settings_path: null, oauth_ready: null })
  it('is true for a voice use and false for messaging and application uses', () => {
    expect(providerHasVoice(provider('twilio.voice'))).toBe(true)
    expect(providerHasVoice(provider('twilio.messaging'))).toBe(false)
    expect(providerHasVoice(provider('inbox.whatsapp'))).toBe(false)
  })
})
