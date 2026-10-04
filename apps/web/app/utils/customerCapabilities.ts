/**
 * Maps a Nasq user's real capabilities (nasq.access.service, /api/v1/me) to the
 * customer commercial capability set. One mapping used by the BFF (authoritative)
 * and by the shell navigation (display only).
 *
 *   subscription.manage + branches.manage + billing.read  ← settings.branding.manage OR access.roles.manage
 *       (both are held by the system_admin built-in role; they are the settings-administration capabilities)
 *   subscription.read                                      ← any of the above OR access.users.read
 *       (a settings reader may see plan/usage; no mutations)
 */
export const CUSTOMER_COMMERCIAL_CAPABILITIES = ['subscription.read', 'subscription.manage', 'branches.manage', 'billing.read'] as const
export type CustomerCommercialCapability = (typeof CUSTOMER_COMMERCIAL_CAPABILITIES)[number]

export function deriveCustomerCapabilities(nasqCapabilities: readonly string[] | undefined | null): CustomerCommercialCapability[] {
  const has = (c: string) => Array.isArray(nasqCapabilities) && nasqCapabilities.includes(c)
  const admin = has('settings.branding.manage') || has('access.roles.manage')
  if (admin) return ['subscription.read', 'subscription.manage', 'branches.manage', 'billing.read']
  if (has('access.users.read')) return ['subscription.read']
  return []
}
