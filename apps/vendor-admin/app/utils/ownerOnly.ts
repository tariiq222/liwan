import type { VendorCapability } from '@liwan/commercial-contracts'

/**
 * Actions that need two grants together and stay with the platform owner (owner decision 2026-11-22): an account holding only one of
 * the two is told so, instead of finding the action hidden or refused. The control plane enforces both grants on its own.
 */
const REQUIRED = {
  customTerms: ['vendor.pricing.manage', 'vendor.subscriptions.manage'],
  restorePublication: ['vendor.operations.run', 'vendor.tenants.manage'],
  sharedOnboarding: ['vendor.operations.run', 'vendor.tenants.manage'],
  voidInvoice: ['vendor.billing.manage', 'vendor.subscriptions.manage'],
} as const satisfies Record<string, readonly [VendorCapability, VendorCapability]>

export type OwnerOnlyAction = keyof typeof REQUIRED
/** `granted` holds both, `partial` holds exactly one (the text applies), `none` holds neither. */
export type OwnerOnlyAccess = 'granted' | 'partial' | 'none'

export function ownerOnlyAccess(action: OwnerOnlyAction, can: (capability: VendorCapability) => boolean): OwnerOnlyAccess {
  const held = REQUIRED[action].filter(capability => can(capability)).length
  return held === 2 ? 'granted' : held === 1 ? 'partial' : 'none'
}
export const ownerOnlyTextKey = (action: OwnerOnlyAction) => `vendor.ownerOnly.${action}`
export const OWNER_ONLY_ACTIONS = Object.keys(REQUIRED) as OwnerOnlyAction[]
