import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CancelPanel from '../../app/components/subscription/CancelPanel.vue'
import { storyContext } from '../support/context'
const meta = { title: 'Subscription/CancelPanel', component: CancelPanel, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/subscription/index.vue:181') },
  args: { cancellation: null, cancellable: true, renewalOn: '2026-12-12', canManage: true } } satisfies Meta<typeof CancelPanel>
export default meta
type Story = StoryObj<typeof meta>
export const Available: Story = {}
export const Cancelled: Story = { args: { cancellable: false, cancellation: { requested_at: '2026-11-20T09:00:00.000Z', requested_by: 'customer', effective_on: '2026-12-12' } } }
export const CancelledByVendor: Story = { args: { cancellable: false, cancellation: { requested_at: '2026-11-20T09:00:00.000Z', requested_by: 'vendor', effective_on: '2026-12-12' } } }
export const ReadOnly: Story = { args: { canManage: false } }
export const Saving: Story = { args: { pending: true } }
