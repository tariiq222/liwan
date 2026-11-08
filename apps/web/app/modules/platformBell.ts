import type { AppBellKind } from './types'

/**
 * Bell kinds of the platform itself, which belongs to no application manifest (the customer subscription
 * is foundation, not an application). `storage.limit_warning` goes to the tenant administrators, the same
 * holders as `subscription.manage` (see `deriveCustomerCapabilities`); the server words the title and body.
 */
export const PLATFORM_BELL: { capabilities: readonly string[]; kinds: readonly AppBellKind[] } = {
  capabilities: ['settings.branding.manage', 'access.roles.manage'],
  kinds: [{ kind: 'storage.limit_warning', href: () => '/subscription/change' }],
}
