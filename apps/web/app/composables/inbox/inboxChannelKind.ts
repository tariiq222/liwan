import type { InboxChannelKind } from '@liwan/contracts'

/** The brand icon of a channel kind: a local SVG in currentColor, never fetched at runtime (DESIGN.md). */
export const CHANNEL_KIND_ICON: Record<InboxChannelKind, string> = {
  whatsapp: 'i-liwan-whatsapp',
  tiktok: 'i-liwan-tiktok',
}

/** The translated name of a channel kind, wherever the UI names one (a list row, a header, a settings field). */
export const channelKindLabelKey = (kind: InboxChannelKind) => `inbox.channelKinds.${kind}`
