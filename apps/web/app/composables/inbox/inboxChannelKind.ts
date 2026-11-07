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
