import { describe, expect, it } from 'vitest'
import { CHANNEL_KIND_ICON, channelKindLabelKey, channelTabPath, channelTabs, visibleChannelTabs } from '../inboxChannelKind'

describe('channel kind presentation', () => {
  it('names every kind with its own brand icon and translated label', () => {
    expect(CHANNEL_KIND_ICON).toEqual({ whatsapp: 'i-liwan-whatsapp', tiktok: 'i-liwan-tiktok' })
    expect(channelKindLabelKey('whatsapp')).toBe('inbox.channelKinds.whatsapp')
    expect(channelKindLabelKey('tiktok')).toBe('inbox.channelKinds.tiktok')
  })
})

describe('channel tabs', () => {
  it('keeps the WhatsApp number health, profile and templates tabs', () => {
    expect(channelTabs('whatsapp')).toEqual(['details', 'health', 'profile', 'templates'])
  })

  it('gives a TikTok channel its automation, shortcuts and import tabs instead', () => {
    expect(channelTabs('tiktok')).toEqual(['details', 'automation', 'shortcuts', 'import'])
    for (const tab of ['health', 'profile', 'templates'] as const) {
      expect(channelTabs('tiktok')).not.toContain(tab)
    }
  })

  it('opens the details tab on the channel page itself and every other tab below it', () => {
    expect(channelTabPath(7, 'details')).toBe('/settings/apps/inbox/channels/7')
    expect(channelTabPath(7, 'import')).toBe('/settings/apps/inbox/channels/7/import')
  })

  it('offers a section only when its sub-feature and its capability are both open', () => {
    const open = { templates: true, automation: true, canTemplates: true, canChannels: true, canAutomation: true }
    expect(visibleChannelTabs('whatsapp', open)).toEqual(['details', 'health', 'profile', 'templates'])
    expect(visibleChannelTabs('tiktok', open)).toEqual(['details', 'automation', 'shortcuts', 'import'])
    expect(visibleChannelTabs('whatsapp', { ...open, templates: false })).toEqual(['details', 'health', 'profile'])
    expect(visibleChannelTabs('tiktok', { ...open, canAutomation: false })).toEqual(['details', 'shortcuts', 'import'])
    expect(visibleChannelTabs('tiktok', { ...open, automation: false })).toEqual(['details', 'shortcuts', 'import'])
    // A templates manager who is not a channel administrator keeps the templates tab, never the admin-only tabs.
    expect(visibleChannelTabs('whatsapp', { ...open, canChannels: false })).toEqual(['details', 'templates'])
  })
})
