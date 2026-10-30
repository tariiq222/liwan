import { VENDOR_ROLES, type VendorCapability, type VendorRole } from '@liwan/commercial-contracts'

const ROLE_CAPABILITIES: Record<VendorRole, VendorCapability[]> = {
  owner: ['vendor.read','vendor.audit.read','vendor.tenants.manage','vendor.subscriptions.manage','vendor.catalog.manage','vendor.pricing.manage','vendor.billing.manage','vendor.operations.run','vendor.accounts.manage'],
  customer_success: ['vendor.read','vendor.tenants.manage','vendor.subscriptions.manage'],
  finance: ['vendor.read','vendor.billing.manage'],
  product: ['vendor.read','vendor.catalog.manage','vendor.pricing.manage'],
  operations: ['vendor.read','vendor.operations.run'],
  support: ['vendor.read','vendor.audit.read'],
}
export const capabilitiesFor = (roles: readonly VendorRole[]): VendorCapability[] =>
  [...new Set(roles.flatMap((role) => ROLE_CAPABILITIES[role]))].sort()
export const STEP_UP_CAPABILITIES: readonly VendorCapability[] = ['vendor.pricing.manage','vendor.billing.manage','vendor.operations.run','vendor.accounts.manage']
export const rolesGranting = (capability: VendorCapability): VendorRole[] =>
  VENDOR_ROLES.filter((role) => ROLE_CAPABILITIES[role].includes(capability))
