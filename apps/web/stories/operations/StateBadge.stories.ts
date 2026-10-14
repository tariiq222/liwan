import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StateBadge from '../../app/components/operations/StateBadge.vue'
import { storyContext } from '../support/context'
const meta = { title: 'Operations/StateBadge', component: StateBadge, parameters: { ...storyContext('apps/web/app/pages/operations/[id]/index.vue:66') }, args: { state: 'pending' } } satisfies Meta<typeof StateBadge>
export default meta
type Story = StoryObj<typeof meta>
export const Pending: Story = {}
export const Completed: Story = { args: { state: 'done' } }
export const Returned: Story = { args: { state: 'returned' } }
export const Rejected: Story = { args: { state: 'rejected' } }
