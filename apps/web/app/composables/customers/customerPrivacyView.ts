import type { CustomerErasePreview, CustomerPrivacyIncomplete, CustomerPrivacyItem } from '@liwan/contracts'

export const PRIVACY_REASONS = ['application_has_no_hook', 'session_does_not_cover_every_company', 'caller_cannot_reach_all_records'] as const
export type PrivacyReason = typeof PRIVACY_REASONS[number]

/** The reason a refusal names, or null for a reason this build does not know (the page then shows a generic line). */
export function knownPrivacyReason(reason: string): PrivacyReason | null {
  return (PRIVACY_REASONS as readonly string[]).includes(reason) ? reason as PrivacyReason : null
}

export interface PrivacyGroups { erase: CustomerPrivacyItem[]; retain: CustomerPrivacyItem[]; unhandled: CustomerPrivacyItem[] }

/** Splits the preview items by what the erase does to them; an empty kind is dropped from the page by the caller. */
export function groupPrivacyItems(items: CustomerPrivacyItem[]): PrivacyGroups {
  const groups: PrivacyGroups = { erase: [], retain: [], unhandled: [] }
  for (const item of items) groups[item.action].push(item)
  return groups
}

/** Whether the erase may run: nothing blocks it and the customer is not erased yet. */
export function canRunErase(preview: Pick<CustomerErasePreview, 'incomplete' | 'customer'>): boolean {
  return preview.incomplete.length === 0 && !preview.customer.erased
}

/** The reasons present in a list of blockers, once each and in the order of {@link PRIVACY_REASONS} (unknown ones last). */
export function distinctReasons(incomplete: CustomerPrivacyIncomplete[]): string[] {
  const present = new Set(incomplete.map(entry => entry.reason))
  return [...PRIVACY_REASONS.filter(reason => present.has(reason)), ...[...present].filter(reason => !knownPrivacyReason(reason))]
}
