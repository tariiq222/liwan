import type { AppBellKind } from './types'
import { TENANT_EXPORT_PAGE } from '../utils/tenantExport'

/**
 * Bell kinds of the platform itself, which belongs to no application manifest (the customer subscription
 * is foundation, not an application). `storage.limit_warning` and `tenant.export_result` go to the tenant administrators, the same
 * holders as `subscription.manage` (see `deriveCustomerCapabilities`); the server words the title and body.
 */
export const PLATFORM_BELL: { capabilities: readonly string[]; kinds: readonly AppBellKind[] } = {
  capabilities: ['settings.branding.manage', 'access.roles.manage'],
  kinds: [
    { kind: 'storage.limit_warning', href: () => '/subscription/change' },
    // The requester of a tenant data export gets this when the file is ready or the build failed; the server words it.
    { kind: 'tenant.export_result', href: () => TENANT_EXPORT_PAGE },
  ],
}
