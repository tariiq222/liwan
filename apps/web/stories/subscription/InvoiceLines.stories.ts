import type { Meta, StoryObj } from '@storybook/vue3-vite'
import InvoiceLines from '../../app/components/subscription/InvoiceLines.vue'
import { storyContext } from '../support/context'
import { invoice } from './fixtures'
const meta = { title: 'Subscription/InvoiceLines', component: InvoiceLines, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/subscription/invoices/[id].vue:15') }, args: { invoice } } satisfies Meta<typeof InvoiceLines>
export default meta
type Story = StoryObj<typeof meta>
export const Issued: Story = {}
