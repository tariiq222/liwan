import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PaymentMethodPanel from '../../app/components/subscription/PaymentMethodPanel.vue'
import { storyContext } from '../support/context'
const card = { brand: 'visa', last_four: '4242', exp_month: 3, exp_year: 2030, status: 'active' }
const meta = { title: 'Subscription/PaymentMethodPanel', component: PaymentMethodPanel, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/subscription/index.vue:185') }, args: { card, autoRenew: true, now: new Date('2026-11-14T09:00:00Z') } } satisfies Meta<typeof PaymentMethodPanel>
export default meta
type Story = StoryObj<typeof meta>
export const ActiveAutoRenewOn: Story = {}
export const ActiveAutoRenewOff: Story = { args: { autoRenew: false } }
export const Inactive: Story = { args: { card: { ...card, status: 'inactive' } } }
export const Expired: Story = { args: { card: { ...card, exp_year: 2026, exp_month: 10 } } }
export const NoCard: Story = { args: { card: null, autoRenew: false } }
export const ManagerCanRemove: Story = { args: { canManage: true, hydrated: true } }
export const RemoveRefusedByProvider: Story = { args: { canManage: true, hydrated: true, removeFailure: 'not_removed' } }
