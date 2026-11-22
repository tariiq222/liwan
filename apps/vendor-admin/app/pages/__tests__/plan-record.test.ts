import { afterEach, expect, it, vi } from 'vitest'
import * as commercial from '../../utils/vendorCommercial'
import { catalogReturn, priceFact } from '../../utils/vendorCatalog'
import { formatStorageMb } from '../../utils/storage'
import { policyTaxText } from '../../components/vendor/policySelection'
import { cadenceLabel, formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { mountPage } from '../../__tests__/pageHarness'

const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

const money = (minor: number) => ({ minor, exponent: 2, currency: 'SAR' })
const monthly = { cadence: { unit: 'month' as const, count: 1 }, amount: money(10000) }
const plan = (over: Record<string, unknown> = {}) => ({
  id: 'p2', plan_id: 'plan-a', version: 2, name: 'Growth', status: 'published', available: true, edit_revision: 3, content_digest: 'd', validated_digest: null, customer_count: 4,
  prices: [monthly], extra_branch_prices: [], user_prices: [], storage_prices: [], included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
  included_users: 5, included_storage_mb: 1024, included_extra_branches: 0, extra_branches_limit: 3, platform_limits: { 'ai.messages.monthly': 1000, 'ai.tokens.monthly': null },
  storage_step_mb: 256, storage_step_threshold_mb: 1024, storage_large_step_mb: 5120, policy_revision_id: 'pol-vat', ...over,
})
const policies = [{ id: 'pol-none', timezone: 'Asia/Riyadh', rounding: 'half_up_per_line', tax: { kind: 'none' } }, { id: 'pol-vat', timezone: 'Asia/Riyadh', rounding: 'half_up_per_line', tax: { kind: 'vat_exclusive', rate_bps: 1500 } }]

async function planPage() {
  const api = {
    get: vi.fn(async () => plan()), policies: vi.fn(async () => policies),
    planVersions: vi.fn(async () => [plan(), plan({ id: 'p1', version: 1, status: 'draft', available: false })]),
    quote: vi.fn(async () => null),
  }
  const page = await mountPage('plans/[id].vue', {
    ...commercial, formatStorageMb, catalogReturn, priceFact, policyTaxText, cadenceLabel, formatCommercialMoney,
    useRoute: () => ({ params: { id: 'p2' }, path: '/plans/p2', query: {}, fullPath: '/plans/p2' }),
    useVendorContext: () => ({ can: () => true }), useVendorCommercial: () => api,
  })
  mounted.push(page)
  return { page, api }
}

it('shows the plan\'s storage steps, pricing policy, AI limits and versions', async () => {
  const { page, api } = await planPage()
  const { html, captured } = await page.rendered()
  expect(api.planVersions).toHaveBeenCalledWith('plan-a')
  const sections = captured.filter(node => node.name === 'SharedRecordSection').map(node => node.props['data-testid'])
  expect(sections).toEqual(expect.arrayContaining(['plan-bundles', 'plan-storage', 'plan-policy', 'plan-ai-limits', 'plan-versions']))
  for (const step of ['256 MB', '1 GB', '5 GB']) expect(html).toContain(step)
  expect(html).toContain('vendor.pricing.plan.vat')
  expect(html).toContain('vendor.pricing.plan.aiLimits.ai_messages_monthly')
  expect(html).toContain('1000')
  for (const key of ['ai_tokens_monthly', 'ai_assist_monthly']) expect(html).toContain(`vendor.pricing.plan.aiLimits.${key}`)
  expect(html).toContain('vendor.pricing.limit.unlimited')
  const badges = captured.filter(node => node.name === 'SharedStatusBadge').map(node => node.props.label)
  expect(badges).toEqual(expect.arrayContaining(['vendor.pricing.status.published', 'vendor.pricing.status.draft']))
  expect(html).toContain('Growth')
})
