import type { Meta, StoryObj } from '@storybook/vue3-vite'
import OrderStateBadge from '../../app/components/vendor/OrderStateBadge.vue'
import { storyContext } from '../support/context'
import { order } from './subscriptionFixtures'
const meta = { title: 'Vendor/OrderStateBadge', component: OrderStateBadge, parameters: { layout: 'padded', ...storyContext('apps/web/app/components/vendor/SubscriptionSummary.vue:27') }, args: { order: order() } } satisfies Meta<typeof OrderStateBadge>
export default meta
type Story = StoryObj<typeof meta>
export const Awaiting: Story = {}
export const Applied: Story = { args: { order: order({ payment_state: 'paid', fulfillment_state: 'applied' }) } }
export const NeedsIntervention: Story = { args: { order: order({ payment_state: 'paid', fulfillment_state: 'needs_intervention' }) } }
