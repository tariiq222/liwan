import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import InvoiceLines from '@webvue/commercial-ui/app/components/shared/data/InvoiceLines.vue'
import { subscriptionInvoiceView } from '../../app/utils/subscription'
import { invoice as customerInvoice } from '../subscription/fixtures'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/InvoiceLines',
  component: InvoiceLines,
  parameters: { layout: 'padded', a11y: { test: 'error' } },
  args: { lines: [] },
} satisfies Meta<typeof InvoiceLines>
export default meta
type Story = StoryObj<typeof meta>

export const CustomerList: Story = {
  name: 'فاتورة العميل (قائمة وإجماليات)',
  parameters: storyContext('apps/web/app/pages/subscription/invoices/[id].vue:16'),
  render: () => ({
    components: { InvoiceLines },
    setup() {
      const { t, locale } = useI18n()
      return { view: subscriptionInvoiceView(customerInvoice, t, locale.value) }
    },
    template: '<div class="max-w-2xl"><InvoiceLines layout="list" v-bind="view" /></div>',
  }),
}
