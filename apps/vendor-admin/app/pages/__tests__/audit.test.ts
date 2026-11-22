import { afterEach, expect, it, vi } from 'vitest'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import * as vendorAudit from '../../utils/vendorAudit'
import { mountPage } from './pageHarness'

const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

async function auditPage(query: Record<string, string>, failures: Record<number, unknown> = {}) {
  const request = vi.fn(async () => ({ items: [], total: 0 }))
  const customer = vi.fn(async () => ({ id: 'c1', name: 'Acme' }))
  const page = await mountPage('audit.vue', {
    ...vendorAudit, formatDateTime,
    useRoute: () => ({ query }), useRouter: () => ({ replace: vi.fn() }), useVendorApi: () => ({ request }),
    useVendorSubscriptions: () => ({ customer }), useDebounceFn: (fn: () => void) => fn,
  }, { failures })
  mounted.push(page)
  return { ...page, request, customer }
}

it('retries the customer name together with the list, since both errors are shown in the table', async () => {
  const page = await auditPage({ customer_id: 'c1' }, { 1: { statusCode: 503 } })
  const [list, customer] = page.asyncData
  expect(customer!.error.value).toBeTruthy()
  const table = (await page.rendered()).captured.find(node => node.name === 'SharedDataTable')!
  expect(table.props.error).toBeTruthy()
  await table.props.onRetry()
  expect(list!.refresh).toHaveBeenCalledTimes(1)
  expect(customer!.refresh).toHaveBeenCalledTimes(1)
})
