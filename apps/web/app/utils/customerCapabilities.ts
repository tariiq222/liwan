/**
 * Maps a LiwanOS user's real capabilities (liwan.access.service, /api/v1/me) to the
 * customer commercial capability set. One mapping used by the BFF (authoritative)
 * and by the shell navigation (display only).
 *
 *   subscription.manage + branches.manage + billing.read  ← settings.branding.manage OR access.roles.manage
 *       (both are held by the system_admin built-in role; they are the settings-administration capabilities)
 *   subscription.read                                      ← any of the above OR access.users.read
 *       (a settings reader may see plan/usage; no mutations)
 *   tenant.delete                                          ← settings.company.vat.manage
 *       (deleting the whole workspace is the system administrator's alone: that capability is held by the system_admin role only,
 *       never by a custom role or the vendor support role, unlike the capabilities above which a custom role can carry)
 */
export const CUSTOMER_COMMERCIAL_CAPABILITIES = ['subscription.read', 'subscription.manage', 'branches.manage', 'billing.read', 'tenant.delete'] as const
export type CustomerCommercialCapability = (typeof CUSTOMER_COMMERCIAL_CAPABILITIES)[number]

export function deriveCustomerCapabilities(liwanCapabilities: readonly string[] | undefined | null): CustomerCommercialCapability[] {
  const has = (c: string) => Array.isArray(liwanCapabilities) && liwanCapabilities.includes(c)
  const admin = has('settings.branding.manage') || has('access.roles.manage')
  if (admin) {
    const commercial: CustomerCommercialCapability[] = ['subscription.read', 'subscription.manage', 'branches.manage', 'billing.read']
    return has('settings.company.vat.manage') ? [...commercial, 'tenant.delete'] : commercial
  }
  if (has('access.users.read')) return ['subscription.read']
  return []
}
