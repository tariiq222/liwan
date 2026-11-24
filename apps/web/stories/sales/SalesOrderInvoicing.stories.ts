import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesOrderInvoicing from '../../app/components/sales/SalesOrderInvoicing.vue'
import { storyContext } from '../support/context'
import { orderInvoicing, orderReadyToInvoice } from './salesFixtures'

const meta = {
  title: 'Sales/SalesOrderInvoicing',
  component: SalesOrderInvoicing,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/sales/[id].vue:179', 'فواتير الطلب في صفحة السجل: حالة الفوترة والمبالغ والفواتير برابط كل منها في المالية، ولا تظهر إلا لمن يقرأ فواتير المالية.') },
  args: { invoicing: orderInvoicing, currency: 'SAR', orderId: 2 },
} satisfies Meta<typeof SalesOrderInvoicing>
export default meta
type Story = StoryObj<typeof meta>

export const Invoiced: Story = { name: 'مفوتر بدفعة مقدمة وفاتورة نهائية' }
export const ReadyToInvoice: Story = { name: 'جاهز للفوترة', args: { invoicing: orderReadyToInvoice } }
export const WithCreditNote: Story = {
  name: 'مع إشعار دائن',
  args: { invoicing: { ...orderInvoicing, amount_credited: 74.52, invoices: [{ ...orderInvoicing.invoices[1]!, id: 9003, number: 'RINV/2026/00002', kind: 'credit_note', payment_state: 'paid', amount_residual: 0 }, ...orderInvoicing.invoices] } },
}
export const Online: Story = { name: 'طلب إلكتروني', args: { invoicing: { ...orderReadyToInvoice, can_invoice: false, can_down_payment: false }, online: true } }
