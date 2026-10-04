import type { Meta, StoryObj } from '@storybook/vue3-vite'
import InvoiceLines from '../../app/components/vendor/InvoiceLines.vue'
import { storyContext } from '../support/context'
import { invoice } from './subscriptionFixtures'
const meta = { title: 'Vendor/InvoiceLines', component: InvoiceLines, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/vendor/invoices/[id].vue:31') }, args: { lines: invoice.lines } } satisfies Meta<typeof InvoiceLines>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
