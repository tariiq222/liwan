import type { HostingModel } from '@liwan/commercial-contracts'

// Locale key under `vendor.hosting` for each hosting model.
export const hostingKey: Record<HostingModel, 'sharedManaged' | 'dedicatedManaged' | 'customerHosted'> = { shared_managed: 'sharedManaged', dedicated_managed: 'dedicatedManaged', customer_hosted: 'customerHosted' }
export type VendorTenant = { id: string; name: string; commercial_mode: string; hosting_model: HostingModel; inventory_target: string; catalog_version: string | null; catalog_tier: string | null; status: string; desired_policy: Record<string, unknown> | null; observed_policy: Record<string, unknown> | null; policy_revision: number | null; health_checked_at: string | null; operations_enabled: boolean; available_operations?: unknown; created_at: string }
