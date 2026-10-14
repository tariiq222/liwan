import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import LifecyclePanel from '../../app/components/vendor/LifecyclePanel.vue'
import { me } from '../fixtures/pmo'
import { apiHandlers } from '../handlers/api'
import { storyContext } from '../support/context'
import { bundleView } from './fixtures'

const caps = (capabilities: string[]) => ({ api: [http.get('/api/vendor/v1/context', () => HttpResponse.json({ enabled: true, capabilities })), http.get('/api/v1/me', () => HttpResponse.json(me)), ...apiHandlers] })
const all = ['vendor.read', 'vendor.catalog.manage', 'vendor.pricing.manage']
const meta = {
  title: 'Vendor/LifecyclePanel', component: LifecyclePanel,
  parameters: { layout: 'padded', msw: { handlers: caps(all) }, ...storyContext('apps/web/app/pages/vendor/bundles/[id].vue:36') },
  args: { kind: 'bundle', view: bundleView({ status: 'draft' }) },
} satisfies Meta<typeof LifecyclePanel>
export default meta
type Story = StoryObj<typeof meta>
export const Draft: Story = {}
export const Validated: Story = { args: { view: bundleView({ status: 'validated' }) } }
export const Published: Story = { args: { view: bundleView({ status: 'published', available: true }) } }
export const Withdrawn: Story = { args: { view: bundleView({ status: 'published', available: false }) } }
export const WithIssues: Story = { args: { view: bundleView({ issues: [{ code: 'price_missing', field: 'prices' }, { code: 'currency_mismatch', field: 'prices' }] }) } }
export const PricingBlocked: Story = { parameters: { msw: { handlers: caps(['vendor.read', 'vendor.catalog.manage']) } }, args: { view: bundleView({ status: 'validated' }) } }
