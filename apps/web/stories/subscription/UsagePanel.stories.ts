import type { Meta, StoryObj } from '@storybook/vue3-vite'
import UsagePanel from '../../app/components/subscription/UsagePanel.vue'
import { storyContext } from '../support/context'
import { usageFresh, usageStale, usageUnavailable } from './fixtures'
const meta = { title: 'Subscription/UsagePanel', component: UsagePanel, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/subscription/index.vue:54') }, args: { usage: usageFresh } } satisfies Meta<typeof UsagePanel>
export default meta
type Story = StoryObj<typeof meta>
export const Fresh: Story = {}
export const Stale: Story = { args: { usage: usageStale } }
export const Unavailable: Story = { args: { usage: usageUnavailable } }
