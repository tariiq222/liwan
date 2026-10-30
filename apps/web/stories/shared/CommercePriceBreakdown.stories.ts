import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PriceBreakdown from '@liwan/commercial-ui/app/components/shared/commerce/PriceBreakdown.vue'
import { storyContext } from '../support/context'
import { quote } from './commerceFixtures'
const meta = { title: 'Shared/Commerce/PriceBreakdown', component: PriceBreakdown, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/subscription/change.vue:67') }, args: { quote } } satisfies Meta<typeof PriceBreakdown>
export default meta
type Story = StoryObj<typeof meta>
export const Quoted: Story = {}
export const Loading: Story = { args: { quote: null, pending: true } }
export const Recomputing: Story = { args: { pending: true } }
export const Failed: Story = { args: { quote: null, error: 'تعذّر إكمال الطلب.' } }
export const Empty: Story = { args: { quote: null } }
