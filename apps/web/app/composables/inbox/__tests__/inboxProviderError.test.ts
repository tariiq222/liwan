import { describe, expect, it } from 'vitest'
import { inboxProviderErrorKey } from '../inboxProviderError'

describe('inboxProviderErrorKey', () => {
  it('uses the provider code before the text', () => {
    expect(inboxProviderErrorKey('Invalid parameter', 130429)).toBe('rateLimited')
    expect(inboxProviderErrorKey('rate limit exceeded', 131047)).toBe('windowClosed')
  })

  it.each([
    [190, 'tokenInvalid'],
    [4, 'rateLimited'],
    [80007, 'rateLimited'],
    [130429, 'rateLimited'],
    [131056, 'rateLimited'],
    [131047, 'windowClosed'],
    [131026, 'recipient'],
  ])('maps code %i to %s', (code, key) => {
    expect(inboxProviderErrorKey(null, code)).toBe(key)
  })

  it.each([
    ['Invalid OAuth access token', 'tokenInvalid'],
    ['Too many requests', 'rateLimited'],
    ['Re-engagement message', 'windowClosed'],
    ['Connection reset by peer', 'unreachable'],
    ['Recipient is not a valid WhatsApp number', 'recipient'],
  ])('falls back to the text %s without a code', (text, key) => {
    expect(inboxProviderErrorKey(text)).toBe(key)
  })

  it('is null for unknown text and for an empty message', () => {
    expect(inboxProviderErrorKey('The provider said no')).toBeNull()
    expect(inboxProviderErrorKey('')).toBeNull()
    expect(inboxProviderErrorKey(null)).toBeNull()
    expect(inboxProviderErrorKey(undefined)).toBeNull()
  })

  it('does not promise a retry from the old unconfirmed text', () => {
    expect(inboxProviderErrorKey('provider did not confirm the send')).toBeNull()
  })
})
