import { z } from 'zod'
import type { Pool } from 'pg'
import { catalogReleaseCreateSchema, type VendorCapability } from '@nasq/commercial-contracts'
import { createRelease, listReleases } from './catalog-releases.js'
import { createBundle, getBundle, listBundles, mutateBundle } from './bundles.js'
import { CommercialHttpError } from './lifecycle.js'
import { listPolicies } from './policies.js'
import { getQuote, previewQuote } from './quotes.js'
import { quotePreviewRequestSchema } from '@nasq/commercial-contracts'
import { createPlan, getPlan, listPlans, mutatePlan } from './plans.js'

type Act = 'edit' | 'delete' | 'validate' | 'publish' | 'withdraw' | 'restore' | 'revisions'
export type CommercialInput = { method: string; pathname: string; search?: string; raw: string; issuer: string; actor: number; capabilities: VendorCapability[] }
type Extra = (pool: Pool, input: CommercialInput, url: URL) => Promise<{ status: number; data: unknown } | null>
const extras: Extra[] = []
/** Later stages (plans, policies, quotes) register route handlers here. */
export function registerCommercialRoutes(handler: Extra) { extras.push(handler) }

export function parseBody<T>(raw: string, schema: z.ZodType<T>): T {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new CommercialHttpError('invalid', 422, 'body') }
  const r = schema.safeParse(value)
  if (!r.success) throw new CommercialHttpError('invalid', 422, String(r.error.issues[0]?.path[0] ?? 'body'))
  return r.data
}
export function need(input: CommercialInput, ...caps: VendorCapability[]) {
  for (const c of caps) if (!input.capabilities.includes(c)) throw new CommercialHttpError('forbidden', 403)
}

/** Returns null only when this route is outside /v1/commercial. */
export async function commercialHttp(pool: Pool, input: CommercialInput) {
  if (!input.pathname.startsWith('/v1/commercial/') && input.pathname !== '/v1/commercial') return null
  const path = input.pathname.slice('/v1/commercial'.length)
  const url = new URL(input.pathname + (input.search ?? ''), 'http://localhost')
  const actor = { issuer: input.issuer, actorUid: input.actor }
  const m = input.method

  if (path === '/catalog/releases') {
    if (m === 'GET') { need(input, 'vendor.read'); return { status: 200, data: await listReleases(pool) } }
    if (m === 'POST') {
      need(input, 'vendor.catalog.manage')
      const body = parseBody(input.raw, catalogReleaseCreateSchema)
      const r = await createRelease(pool, actor, body)
      return { status: r.created ? 201 : 200, data: r.release }
    }
    throw new CommercialHttpError('not_found', 404)
  }
  const b = /^\/bundles(?:\/([^/]+))?(?:\/(validate|publish|withdraw|restore|revisions))?$/.exec(path)
  if (b) {
    const id = b[1], action = b[2]
    if (id && !z.uuid().safeParse(id).success) throw new CommercialHttpError('bundle_missing', 404)
    if (m === 'GET' && !action) {
      need(input, 'vendor.read')
      if (!id) return { status: 200, data: await listBundles(pool, url) }
      return { status: 200, data: await getBundle(pool, id, url.searchParams.get('customer_id')) }
    }
    if (m === 'POST' && !id) {
      need(input, 'vendor.catalog.manage')
      const body = parseBody(input.raw, z.unknown())
      // Creating a bundle with prices is a pricing action.
      if (Array.isArray((body as { prices?: unknown } | null)?.prices) && (body as { prices: unknown[] }).prices.length) need(input, 'vendor.pricing.manage')
      return { status: 201, data: await createBundle(pool, actor, body) }
    }
    if (id) {
      let act: Act | null = null
      if (!action && m === 'PATCH') act = 'edit'
      else if (!action && m === 'DELETE') act = 'delete'
      else if (action && m === 'POST') act = action as Act
      if (act) {
        need(input, 'vendor.catalog.manage')
        // Edit may change prices; the store enforces pricing for that case.
        if (['publish', 'withdraw', 'restore'].includes(act)) need(input, 'vendor.pricing.manage')
        const data = await mutateBundle(pool, actor, id, act, parseBody(input.raw, z.unknown()), { pricingGranted: input.capabilities.includes('vendor.pricing.manage') })
        return { status: act === 'revisions' ? 201 : 200, data }
      }
    }
    throw new CommercialHttpError('not_found', 404)
  }
  const pl = /^\/plans(?:\/([^/]+))?(?:\/(validate|publish|withdraw|restore|revisions))?$/.exec(path)
  if (pl) {
    const id = pl[1], action = pl[2]
    if (id && !z.uuid().safeParse(id).success) throw new CommercialHttpError('plan_missing', 404)
    if (m === 'GET' && !action) {
      need(input, 'vendor.read')
      if (!id) return { status: 200, data: await listPlans(pool, url) }
      return { status: 200, data: await getPlan(pool, id, url.searchParams.get('customer_id')) }
    }
    if (m === 'POST' && !id) { need(input, 'vendor.catalog.manage', 'vendor.pricing.manage'); return { status: 201, data: await createPlan(pool, actor, parseBody(input.raw, z.unknown())) } }
    if (id) {
      let act: Act | null = null
      if (!action && m === 'PATCH') act = 'edit'
      else if (!action && m === 'DELETE') act = 'delete'
      else if (action && m === 'POST') act = action as Act
      if (act) {
        need(input, 'vendor.catalog.manage', 'vendor.pricing.manage')
        return { status: act === 'revisions' ? 201 : 200, data: await mutatePlan(pool, actor, id, act, parseBody(input.raw, z.unknown())) }
      }
    }
    throw new CommercialHttpError('not_found', 404)
  }
  if (path === '/policies' && m === 'GET') { need(input, 'vendor.read'); return { status: 200, data: await listPolicies(pool) } }
  if (path === '/quotes' && m === 'POST') { need(input, 'vendor.read'); return { status: 201, data: await previewQuote(pool, parseBody(input.raw, quotePreviewRequestSchema)) } }
  const q = /^\/quotes\/([^/]+)$/.exec(path)
  if (q && m === 'GET') {
    need(input, 'vendor.read')
    if (!z.uuid().safeParse(q[1]).success) throw new CommercialHttpError('quote_missing', 404)
    return { status: 200, data: await getQuote(pool, q[1]!) }
  }
  for (const e of extras) { const r = await e(pool, input, url); if (r) return r }
  throw new CommercialHttpError('not_found', 404)
}
