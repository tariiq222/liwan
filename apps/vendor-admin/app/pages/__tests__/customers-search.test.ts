import { afterEach, expect, it, vi } from 'vitest'
import { useDebounceFn } from '@vueuse/core'
import * as vendorClients from '../../utils/vendorClients'
import { hostingKey } from '../../utils/vendorTenant'
import { isNotAvailable } from '../../utils/vendorSubscriptions'
import { customerDisplayBadge, operationStatusBadge } from '../../utils/vendorBadges'
import { mountPage } from '../../__tests__/pageHarness'

const mounted: { stop: () => void }[] = []
afterEach(() => { mounted.splice(0).forEach(page => page.stop()); vi.useRealTimers() })

async function customersPage(query: Record<string, string> = {}) {
  const replace = vi.fn()
  const listClients = vi.fn(async () => ({ items: [], total: 0 }))
  const page = await mountPage('customers/index.vue', {
    ...vendorClients, hostingKey, isNotAvailable, customerDisplayBadge, operationStatusBadge, useDebounceFn,
    useRoute: () => ({ query, fullPath: '/customers' }), useRouter: () => ({ replace }),
    useVendorSubscriptions: () => ({ listClients }), useVendorContext: () => ({ can: () => true }),
  })
  mounted.push(page)
  return { ...page, replace }
}

it('waits for typing to pause before it replaces the route, and then filters by the last text', async () => {
  vi.useFakeTimers()
  const { state, replace } = await customersPage()
  for (const text of ['A', 'Ac', 'Acm', 'Acme']) { state.search.value = text; state.patchSearch() }
  await vi.advanceTimersByTimeAsync(299)
  expect(replace).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(replace).toHaveBeenCalledTimes(1)
  expect(replace).toHaveBeenCalledWith({ path: '/customers', query: { page: undefined, q: 'Acme' } })
})

it('keeps the URL as the source of the filter: the field follows a changed q', async () => {
  const query = { q: 'Acme' }
  const { state } = await customersPage(query)
  expect(state.search.value).toBe('Acme')
})
