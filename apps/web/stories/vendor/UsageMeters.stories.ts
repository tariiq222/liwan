import type { Meta, StoryObj } from '@storybook/vue3-vite'
import UsageMeters from '../../app/components/vendor/UsageMeters.vue'
import { storyContext } from '../support/context'
import { usage } from './subscriptionFixtures'
const meta = { title: 'Vendor/UsageMeters', component: UsageMeters, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/vendor/customers/[id].vue:75') }, args: { usage: usage() } } satisfies Meta<typeof UsageMeters>
export default meta
type Story = StoryObj<typeof meta>
export const Fresh: Story = {}
export const Unavailable: Story = { args: { usage: usage({ freshness: 'unavailable', observed_at: null, metrics: [{ key: 'users', used: null, limit: 50, unit: 'users', reason: 'source_unreachable' }] }) } }
export const NoData: Story = { args: { usage: null } }
