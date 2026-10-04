import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LifecycleBadge from '../../app/components/vendor/LifecycleBadge.vue'
import { storyContext } from '../support/context'
const meta = { title: 'Vendor/LifecycleBadge', component: LifecycleBadge, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/vendor/bundles/index.vue:40') }, args: { status: 'draft' } } satisfies Meta<typeof LifecycleBadge>
export default meta
type Story = StoryObj<typeof meta>
export const Draft: Story = {}
export const Validated: Story = { args: { status: 'validated' } }
export const Published: Story = { args: { status: 'published', available: true } }
export const Withdrawn: Story = { args: { status: 'published', available: false } }
