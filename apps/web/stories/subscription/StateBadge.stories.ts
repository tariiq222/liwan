import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StateBadge from '../../app/components/subscription/StateBadge.vue'
import { storyContext } from '../support/context'
const meta = { title: 'Subscription/StateBadge', component: StateBadge, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/subscription/index.vue:34') }, args: { state: 'active' } } satisfies Meta<typeof StateBadge>
export default meta
type Story = StoryObj<typeof meta>
export const Active: Story = {}
export const AwaitingPayment: Story = { args: { state: 'awaiting_payment' } }
export const Activating: Story = { args: { state: 'activating' } }
export const Failed: Story = { args: { state: 'failed' } }
export const Inactive: Story = { args: { state: 'inactive' } }
