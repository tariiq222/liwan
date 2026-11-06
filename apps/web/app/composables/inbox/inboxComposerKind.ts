import type { InboxChannelKind } from '@liwan/contracts'

// What a conversation of each kind offers in the workspace: the composer's controls and whether it has templates.
/** Only WhatsApp has approved templates: they are the one reply after its window closes. */
export const channelCarriesTemplates = (kind: InboxChannelKind): boolean => kind === 'whatsapp'

/** The controls the composer offers on a conversation of this kind. */
export type InboxComposerAction = 'attach' | 'location' | 'interactive' | 'products'

/**
 * Whatsapp offers every control (products only when the channel has a catalog); TikTok offers a text, one image and a
 * button card, so no template, no location, no product, no list and no link (D3).
 */
export function inboxComposerActions(kind: InboxChannelKind, options: { commerceReady: boolean }): readonly InboxComposerAction[] {
  if (kind === 'tiktok') return ['attach', 'interactive']
  return options.commerceReady ? ['attach', 'location', 'interactive', 'products'] : ['attach', 'location', 'interactive']
}
