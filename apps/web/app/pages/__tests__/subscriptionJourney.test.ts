import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { subscriptionDisplayState } from '@nasq/commercial-contracts'
import { safePaymentRedirect, forgetIdempotencyKey, idempotencyKey, QUOTE_IS_EXPIRED, safeIdemAction, sanitizeBody, usageFigure, usageMetricLabel } from '../../utils/subscription'
import { deriveCustomerCapabilities } from '../../utils/customerCapabilities'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const page = (p: string) => read(`app/pages/subscription/${p}`)
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } }
const order = (payment_state: string, fulfillment_state: string) => ({ payment_state, fulfillment_state }) as never

describe('display state mapping', () => {
  it('shows entitled applications from features, not the release module list', () => {
    expect(page('index.vue')).not.toContain('entitlement.modules')
    expect(page('index.vue')).toContain('entitledFeaturePrefixes')
  })
  it('maps honest states', () => {
    expect(subscriptionDisplayState({ state: 'pending', applied: null, pending_order: order('awaiting_payment', 'not_started') })).toBe('awaiting_payment')
    expect(subscriptionDisplayState({ state: 'active', applied: {} as never, pending_order: order('paid', 'queued') })).toBe('activating')
    expect(subscriptionDisplayState({ state: 'active', applied: {} as never, pending_order: order('paid', 'failed') })).toBe('failed')
    expect(subscriptionDisplayState({ state: 'active', applied: {} as never, pending_order: null })).toBe('active')
  })
})
describe('usage never shows unknown as 0', () => {
  const m = { key: 'users', used: null, limit: 10, unit: 'users', reason: 'timeout' } as never
  it('unavailable freshness and null used are unknown', () => {
    expect(usageFigure(m, 'unavailable')).toMatchObject({ value: null, known: false })
    expect(usageFigure({ ...(m as object), used: 0, reason: null } as never, 'unavailable')).toMatchObject({ value: null, known: false })
    expect(usageFigure({ ...(m as object), used: 0, reason: null } as never, 'fresh')).toMatchObject({ value: 0, known: true })
    expect(usageFigure({ ...(m as object), used: 3, reason: null } as never, 'stale')).toMatchObject({ value: 3, stale: true })
  })
  it('panel renders the unavailable label instead of a number', () => {
    const c = read('app/components/subscription/UsagePanel.vue')
    expect(c).toContain('!f.known'); expect(c).toContain('subscription.usage.unavailable')
  })
})
describe('permission gating', () => {
  it('pages gate on customer capabilities and use hydration', () => {
    expect(page('change.vue')).toContain("can('subscription.manage')"); expect(page('change.vue')).toContain('useHydrated')
    expect(page('branches/new.vue')).toContain("can('branches.manage')"); expect(page('invoices/index.vue')).toContain("can('billing.read')")
    expect(read('app/components/subscription/AutoRenewControl.vue')).toContain('consent')
    expect(deriveCustomerCapabilities(['access.users.read'])).not.toContain('subscription.manage')
  })
  it('uses shared structure: page state, create panel, unsaved changes, the shared price breakdown', () => {
    expect(page('index.vue')).toContain('SharedPageState'); expect(page('branches/new.vue')).toContain('SharedCreatePanel')
    expect(page('change.vue')).toContain('SharedUnsavedChanges'); expect(page('change.vue')).toContain('SharedCommercePriceBreakdown')
  })
  it('status page never creates orders or payments on load', () => {
    const s = page('status.vue')
    expect(s).toContain('api.subscription()'); expect(s).not.toMatch(/api\.accept|api\.quote/)
    expect(s).toMatch(/continuePayment/)
  })
  it('invoice page labels non-official invoices and has no physical RTL classes', () => {
    expect(read('app/utils/subscription.ts')).toContain('subscription.invoices.notOfficial')
    for (const f of ['index.vue', 'change.vue', 'status.vue', 'branches.vue', 'branches/new.vue', 'invoices/index.vue', 'invoices/[id].vue']) expect(page(f)).not.toMatch(/\b(ml|mr|pl|pr)-\d/)
  })
})
describe('idempotency and quote handling', () => {
  it('reuses the key across retry/refresh until forgotten', () => {
    const s = mem(); let n = 0; const make = () => `key-${++n}`
    const a = idempotencyKey(s, 'change:x', make); expect(idempotencyKey(s, 'change:x', make)).toBe(a)
    forgetIdempotencyKey(s, 'change:x'); expect(idempotencyKey(s, 'change:x', make)).not.toBe(a)
  })
  it('action name is stable for equal inputs and changes with revision/content', () => {
    expect(safeIdemAction('change', 's', 1, 'a')).toBe(safeIdemAction('change', 's', 1, 'a'))
    expect(safeIdemAction('change', 's', 2, 'a')).not.toBe(safeIdemAction('change', 's', 1, 'a'))
  })
  it('expired quotes are detected; bodies are stripped of identity; payment redirects are restricted', () => {
    expect(QUOTE_IS_EXPIRED({ expires_at: '2000-01-01T00:00:00Z' })).toBe(true)
    expect(sanitizeBody({ a: 1, tenant_id: 't', customer_id: 'c', capabilities: [] })).toEqual({ a: 1 })
    expect(safePaymentRedirect('https://pay.example/x', 'https://acme.example')).toBe('https://pay.example/x')
    expect(safePaymentRedirect('http://pay.example/x', 'https://acme.example')).toBeNull()
    expect(safePaymentRedirect('javascript:alert(1)', 'https://acme.example')).toBeNull()
    const c = page('change.vue'); expect(c).toContain("'conflict'"); expect(c).toContain("'expired'")
  })
  it('labels usage by limit key, then unit, then a readable id', () => {
    const t = (k: string) => `T:${k}`
    const te = (k: string) => ['subscription.usage.keys.users_limit', 'subscription.usage.count'].includes(k)
    expect(usageMetricLabel({ key: 'users.limit', unit: 'users' } as never, t, te)).toBe('T:subscription.usage.keys.users_limit')
    expect(usageMetricLabel({ key: 'probe.items', unit: 'count' } as never, t, te)).toBe('T:subscription.usage.count')
    expect(usageMetricLabel({ key: 'probe.items', unit: 'projects' } as never, t, () => false)).toBe('Probe items')
  })
  it('locales carry the same keys', () => {
    const flat = (o: unknown, p = ''): string[] => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => flat(v, `${p}${k}.`)) : [p])
    expect(flat(JSON.parse(read('i18n/locales/ar/subscription.json'))).sort()).toEqual(flat(JSON.parse(read('i18n/locales/en/subscription.json'))).sort())
  })
})
