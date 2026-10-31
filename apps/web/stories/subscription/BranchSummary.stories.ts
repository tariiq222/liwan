import type { Meta, StoryObj } from '@storybook/vue3-vite'
import BranchSummary from '../../app/components/subscription/BranchSummary.vue'
import { storyContext } from '../support/context'
import { branches } from './fixtures'
const meta = { title: 'Subscription/BranchSummary', component: BranchSummary, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/subscription/branches.vue:56') }, args: { summary: branches } } satisfies Meta<typeof BranchSummary>
export default meta
type Story = StoryObj<typeof meta>
export const Mixed: Story = {}
export const HeadquartersOnly: Story = { args: { summary: { ...branches, items: branches.items.slice(0, 1), total: 1, free_extra_used: 0, paid: 0 } } }
