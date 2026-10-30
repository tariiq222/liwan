import { z } from 'zod'
import { CUSTOMER_CAPABILITIES, principalSchema, type Principal } from '@liwan/commercial-contracts'
import { CommercialHttpError } from './lifecycle.js'

export function requireCapability(principal: Pick<Principal, 'capabilities'>, ...capabilities: string[]) {
  if (capabilities.some(capability => !principal.capabilities.includes(capability))) throw new CommercialHttpError('forbidden', 403)
}
export function requireVendor(principal: Principal, ...capabilities: string[]) {
  if (principal.kind !== 'vendor') throw new CommercialHttpError('forbidden', 403)
  requireCapability(principal, ...capabilities)
}
// tenant_id is the control tenant id (dedicated web) or the shared registry tenant id (shared web, see shared_registry_bindings).
const wire = z.strictObject({ actor_id: z.string().regex(/^[1-9][0-9]*$/), kind: z.literal('customer'), tenant_id: z.union([z.uuid(), z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/)]), capabilities: z.array(z.enum(CUSTOMER_CAPABILITIES)) })
/** customer_id is deliberately absent from the signed wire protocol; the DB binding supplies it. */
export function parseCustomerPrincipal(header: string, customerId: string): Principal {
  try {
    if (header.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header)) throw Error('invalid')
    const input = wire.parse(JSON.parse(Buffer.from(header, 'base64').toString('utf8')))
    return principalSchema.parse({ ...input, customer_id: customerId })
  } catch { throw new CommercialHttpError('unauthorized', 401) }
}
export function assertNoCustomerIdentity(value: unknown): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach(assertNoCustomerIdentity); return }
  for (const [key, item] of Object.entries(value)) {
    if (['tenant_id', 'customer_id', 'capabilities', 'principal', 'actor_id', 'issuer', 'tenantid', 'customerid'].includes(key.toLowerCase())) throw new CommercialHttpError('forbidden_field', 400, key)
    assertNoCustomerIdentity(item)
  }
}
