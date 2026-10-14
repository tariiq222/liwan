import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AutoRenewControl from '../../app/components/subscription/AutoRenewControl.vue'
import { storyContext } from '../support/context'
const meta = { title: 'Subscription/AutoRenewControl', component: AutoRenewControl, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/subscription/index.vue:65') }, args: { enabled: false, canManage: true } } satisfies Meta<typeof AutoRenewControl>
export default meta
type Story = StoryObj<typeof meta>
export const Off: Story = {}
export const On: Story = { args: { enabled: true } }
export const ReadOnly: Story = { args: { canManage: false } }
export const Saving: Story = { args: { enabled: true, pending: true } }
