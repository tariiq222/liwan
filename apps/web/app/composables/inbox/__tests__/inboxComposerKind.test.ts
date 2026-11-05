import { describe, expect, it } from 'vitest'
import { channelCarriesTemplates, inboxComposerActions } from '../inboxComposerKind'

describe('what a conversation of each kind offers', () => {
  it('offers TikTok a text, one image and a button card: no template, location, product, list or link', () => {
    expect(inboxComposerActions('tiktok', { commerceReady: true })).toEqual(['attach', 'interactive'])
    expect(channelCarriesTemplates('tiktok')).toBe(false)
  })

  it('keeps every WhatsApp action, with products only when the channel has a catalog', () => {
    expect(inboxComposerActions('whatsapp', { commerceReady: true })).toEqual(['attach', 'location', 'interactive', 'products'])
    expect(inboxComposerActions('whatsapp', { commerceReady: false })).toEqual(['attach', 'location', 'interactive'])
    expect(channelCarriesTemplates('whatsapp')).toBe(true)
  })
})
