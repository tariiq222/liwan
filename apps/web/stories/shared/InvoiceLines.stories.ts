import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import InvoiceLines from '../../app/components/shared/data/InvoiceLines.vue'
import { subscriptionInvoiceView } from '../../app/utils/subscription'
import { vendorInvoiceLineViews } from '../../app/utils/vendorSubscriptions'
import { invoice as customerInvoice } from '../subscription/fixtures'
import { invoice as vendorInvoice } from '../vendor/subscriptionFixtures'
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
export const VendorTable: Story = {
  name: 'فاتورة المورّد (جدول)',
  parameters: storyContext('apps/web/app/pages/vendor/invoices/[id].vue:32'),
  render: () => ({
    components: { InvoiceLines },
    setup() {
      const { t, locale } = useI18n()
      return { lines: vendorInvoiceLineViews(vendorInvoice.lines, t, locale.value) }
    },
    template: '<UCard class="max-w-4xl"><InvoiceLines :lines="lines" /></UCard>',
  }),
}
