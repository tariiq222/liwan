import { afterEach, expect, it, vi } from 'vitest'
import { createSSRApp, effectScope, ref, type EffectScope } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { useShellNotice } from '../useShellNotice'

const scopes: EffectScope[] = [], clients: QueryClient[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

const view = (over: Record<string, unknown> = {}) => ({ state: 'trialing', trial_ends_at: new Date(Date.now() + 2 * 86_400_000).toISOString(), grace_ends_at: null, cancellation: null, pending_free_base_lock: null, ...over })
async function mount(meOver: Record<string, unknown>, subscription = vi.fn(async () => view())) {
  const me = ref({ id: 1, company: { id: 2 }, capabilities: [], read_only: false, platform: { state: 'active' }, commercial: { mode: 'saas' }, ...meOver })
  vi.stubGlobal('useMe', () => ({ me: { get value() { return me.value } } }))
  vi.stubGlobal('useHydrated', () => ref(true))
  vi.stubGlobal('useSubscriptionApi', () => ({ subscription }))
  const qc = new QueryClient(), scope = effectScope(), app = createSSRApp({ render: () => null })
  clients.push(qc); scopes.push(scope); app.use(VueQueryPlugin, { queryClient: qc })
  const api = app.runWithContext(() => scope.run(() => useShellNotice())!)
  await new Promise(resolve => setTimeout(resolve, 20))
  return { subscription, ...api }
}

it('never requests the subscription for a plain member', async () => {
  const run = await mount({ capabilities: ['crm.leads.read'] })
  expect(run.subscription).not.toHaveBeenCalled()
  expect(run.notice.value).toBeNull()
})

it('still tells a member about the tenant payment lock, without asking for billing data', async () => {
  const run = await mount({ capabilities: [], platform: { state: 'payment_suspended' } })
  expect(run.subscription).not.toHaveBeenCalled()
  expect(run.notice.value).toMatchObject({ key: 'payment_suspended' })
  expect(run.notice.value?.action).toBeUndefined()
})

it('returns nothing and requests nothing in non_saas', async () => {
  const run = await mount({ capabilities: ['settings.branding.manage'], commercial: { mode: 'non_saas' }, platform: { state: 'payment_suspended' } })
  expect(run.subscription).not.toHaveBeenCalled()
  expect(run.notice.value).toBeNull()
})

it('reads the subscription once for a manager and shows the trial notice', async () => {
  const run = await mount({ capabilities: ['settings.branding.manage'] })
  expect(run.subscription).toHaveBeenCalledTimes(1)
  expect(run.notice.value).toMatchObject({ key: 'trial_ending', action: { to: '/subscription/change' } })
})

it('treats a missing subscription (404) as no notice', async () => {
  const run = await mount({ capabilities: ['settings.branding.manage'] }, vi.fn(async () => { throw { statusCode: 404 } }))
  expect(run.notice.value).toBeNull()
})
