import type { InboxChannelKind } from '@liwan/contracts'

/** The brand icon of a channel kind: a local SVG in currentColor, never fetched at runtime (DESIGN.md). */
export const CHANNEL_KIND_ICON: Record<InboxChannelKind, string> = {
  whatsapp: 'i-liwan-whatsapp',
  tiktok: 'i-liwan-tiktok',
}

/** The translated name of a channel kind, wherever the UI names one (a list row, a header, a settings field). */
export const channelKindLabelKey = (kind: InboxChannelKind) => `inbox.channelKinds.${kind}`

export type InboxChannelTab = 'details' | 'health' | 'profile' | 'templates' | 'automation' | 'shortcuts' | 'import'

// A WhatsApp number is read through Meta: its number health, its business profile and its templates. A TikTok account
// has none of those: it has its own automation, its suggested questions and chat prompts, and its history import (D10, D11).
const WHATSAPP_TABS: readonly InboxChannelTab[] = ['details', 'health', 'profile', 'templates']
const TIKTOK_TABS: readonly InboxChannelTab[] = ['details', 'automation', 'shortcuts', 'import']

/** The sections of a channel page: they follow the kind, never a second page per kind. */
export function channelTabs(kind: InboxChannelKind): readonly InboxChannelTab[] {
  return kind === 'tiktok' ? TIKTOK_TABS : WHATSAPP_TABS
}

/** The route of one section: the details are the channel page itself, the others live below it. */
export function channelTabPath(channelId: number, tab: InboxChannelTab): string {
  const base = `/settings/apps/inbox/channels/${channelId}`
  return tab === 'details' ? base : `${base}/${tab}`
}

/** What the viewer holds: a templates tab needs its sub-feature and one of its two capabilities; automation the same. */
export interface InboxChannelTabAccess {
  templates: boolean
  automation: boolean
  canTemplates: boolean
  canChannels: boolean
  canAutomation: boolean
}

/** The sections of a channel that both its kind and the viewer's capabilities and features offer. */
export function visibleChannelTabs(kind: InboxChannelKind, access: InboxChannelTabAccess): readonly InboxChannelTab[] {
  return channelTabs(kind).filter((tab) => {
    if (tab === 'templates') return access.templates && (access.canTemplates || access.canChannels)
    if (tab === 'automation') return access.automation && access.canAutomation
    // The remaining sections belong to channel administration itself (the details is the page these tabs live on).
    if (tab === 'details') return true
    return access.canChannels
  })
}
