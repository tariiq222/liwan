// Definition/configuration facts are not changed by conversation or template producers.
const STATIC_FAMILIES = new Set([
  'canned-replies', 'tags', 'agents', 'settings', 'departments', 'channel-ref',
  'campaign-channels', 'campaign-settings', 'automation-channels', 'working-hours', 'automation', 'rules',
  'catalogs', 'catalog', 'catalog-items', 'catalog-item', 'catalog-products', 'channel-commerce', 'catalog-pick',
])

function matchesOrUnknown(ids: ReadonlySet<number>, relation: unknown): boolean {
  return typeof relation !== 'number' || !Number.isInteger(relation) || relation <= 0 || ids.has(relation)
}

/** Existing id-only events can include mixed provider-batch effects; unknown dynamic resources stay conservative. */
export function inboxEventAffectsQuery(
  key: readonly unknown[],
  data: unknown,
  conversationIds: ReadonlySet<number>,
  templateIds: ReadonlySet<number>,
): boolean {
  const conversation = conversationIds.size > 0
  const template = templateIds.size > 0
  if (key[0] !== 'inbox' || (!conversation && !template) || STATIC_FAMILIES.has(key[1] as string)) return false
  if (key[1] === 'conversations') return conversation
  if (key[1] === 'conversation' || key[1] === 'messages') return conversationIds.has(key[2] as number)
  if (key[1] === 'orders') return conversation && (key[2] !== 'conversation' || conversationIds.has(key[3] as number))
  if (key[1] === 'order') {
    // The canonical detail supplies the relation; an initial or missing response cannot exclude this order.
    const relation = data && typeof data === 'object' ? (data as { conversation_id?: unknown }).conversation_id : undefined
    return conversation && matchesOrUnknown(conversationIds, relation)
  }
  if (key[1] === 'flows' && key[2] === 'conversation') return conversationIds.has(key[3] as number)
  if (key[1] === 'templates') return template
  if (key[1] === 'template') return templateIds.has(key[2] as number)
  if (key[1] === 'campaigns' && key[2] === 'preview') {
    // Preview renders template parameters, not consent/eligibility; ordinary conversation changes do not affect it.
    return template && matchesOrUnknown(templateIds, (key[3] as { template_id?: unknown } | undefined)?.template_id)
  }
  if (key[1] === 'reports' && key[2] === 'template') return conversation || matchesOrUnknown(templateIds, key[3])
  if (key[1] === 'tiktok-shortcuts' || key[1] === 'tiktok-sync') return conversation
  // Flows, campaigns, audiences, contact marketing and channel metadata/health can change together in one webhook.
  // Reports also retain the old opportunistic refresh, without claiming every message rebuilds daily aggregates.
  return true
}
