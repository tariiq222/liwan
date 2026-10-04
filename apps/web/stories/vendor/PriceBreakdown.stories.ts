import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PriceBreakdown from '../../app/components/vendor/PriceBreakdown.vue'
import { storyContext } from '../support/context'
import { quote } from './fixtures'
const meta = { title: 'Vendor/PriceBreakdown', component: PriceBreakdown, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/vendor/plans/[id].vue:72') }, args: { quote } } satisfies Meta<typeof PriceBreakdown>
export default meta
type Story = StoryObj<typeof meta>
export const Quoted: Story = {}
export const Loading: Story = { args: { quote: null, pending: true } }
export const Recomputing: Story = { args: { pending: true } }
export const Failed: Story = { args: { quote: null, error: 'تعذّر إكمال الطلب.' } }
export const Empty: Story = { args: { quote: null } }
