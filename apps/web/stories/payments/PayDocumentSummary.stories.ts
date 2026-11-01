import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { PayableInvoice, PayableOrder } from '@liwan/contracts'
import PayDocumentSummary from '../../app/components/payments/PayDocumentSummary.vue'
import { storyContext } from '../support/context'

const shared = { id: 2, merchant: 'ليوان', currency: 'SAR', amount_untaxed: 14700, amount_tax: 2205, amount_total: 16905, amount_due: 16905, status: 'payable' as const, options: [] }
const invoice: PayableInvoice = { ...shared, number: 'INV/2026/0002', due_date: '2026-10-31' }
const order: PayableOrder = { ...shared, number: 'S00017', expires_at: '2026-10-31T12:30:00Z' }

const meta = {
  title: 'Payments/PayDocumentSummary',
  component: PayDocumentSummary,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/pay/[kind]/[id]/index.vue:62', 'ما يراه الدافع من الفاتورة أو الطلب في صفحة الدفع العامة: المبلغ المستحق والجهة والرقم وآخر موعد، وإجمالي المستند حين يختلف عن المستحق.'),
  },
  args: { kind: 'invoice', payable: invoice },
} satisfies Meta<typeof PayDocumentSummary>
export default meta
type Story = StoryObj<typeof meta>

export const Invoice: Story = {}
export const InvoicePaidInPart: Story = { args: { payable: { ...invoice, amount_due: 3000, amount_total: 8000 } satisfies PayableInvoice } }
export const InvoiceWithoutDueDate: Story = { args: { payable: { ...invoice, due_date: null } satisfies PayableInvoice } }
export const Order: Story = { args: { kind: 'order', payable: order } }
export const OrderDeposit: Story = { args: { kind: 'order', payable: { ...order, amount_due: 5000, amount_total: 16905 } satisfies PayableOrder } }
export const OrderWithoutExpiry: Story = { args: { kind: 'order', payable: { ...order, expires_at: null } satisfies PayableOrder } }
