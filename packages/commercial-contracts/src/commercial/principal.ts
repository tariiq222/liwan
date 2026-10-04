import { z } from 'zod'

export const CUSTOMER_CAPABILITIES = ['subscription.read', 'subscription.manage', 'branches.manage', 'billing.read'] as const
export const VENDOR_COMMERCIAL_CAPABILITIES = ['vendor.subscriptions.manage', 'vendor.pricing.manage', 'vendor.billing.manage'] as const
export const customerCapabilitySchema = z.enum(CUSTOMER_CAPABILITIES)
export type CustomerCapability = z.infer<typeof customerCapabilitySchema>

/** Capabilities are strings (vendor set lives in the root contracts); the customer set is fixed above. */
export const principalSchema = z.strictObject({
  actor_id: z.string().min(1), kind: z.enum(['vendor', 'customer']),
  customer_id: z.string().nullable(), tenant_id: z.string().nullable(), capabilities: z.array(z.string().min(1)),
}).refine(p => p.kind === 'vendor' || p.customer_id !== null, { path: ['customer_id'], message: 'Customer principal needs customer_id' })
export type Principal = z.infer<typeof principalSchema>

export const hasCapability = (p: Pick<Principal, 'capabilities'>, c: string): boolean => p.capabilities.includes(c)
