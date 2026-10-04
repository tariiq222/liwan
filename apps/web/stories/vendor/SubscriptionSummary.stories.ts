import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SubscriptionSummary from '../../app/components/vendor/SubscriptionSummary.vue'
import { storyContext } from '../support/context'
import { order, subscription } from './subscriptionFixtures'
const meta = { title: 'Vendor/SubscriptionSummary', component: SubscriptionSummary, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/vendor/customers/[id].vue:56') }, args: { subscription: subscription(), planName: 'الباقة الأساسية' } } satisfies Meta<typeof SubscriptionSummary>
export default meta
type Story = StoryObj<typeof meta>
export const Active: Story = {}
export const AwaitingPayment: Story = { args: { subscription: subscription({ state: 'pending', pending_order: order() }) } }
export const FailedTarget: Story = { args: { subscription: subscription({ pending_order: order({ payment_state: 'paid', fulfillment_state: 'failed' }) }) } }
