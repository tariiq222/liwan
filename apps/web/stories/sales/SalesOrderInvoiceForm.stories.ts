import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesOrderInvoiceForm from '../../app/components/sales/SalesOrderInvoiceForm.vue'
import { storyContext } from '../support/context'
import { confirmedOrder, orderInvoicing, orderReadyToInvoice } from './salesFixtures'

const order = { ...confirmedOrder, invoicing: orderReadyToInvoice }
const made = http.post('/api/v1/sales/orders/2/invoices', () => HttpResponse.json({ ...order, invoicing: orderInvoicing }))
const refused = (status: number, body: object) => http.post('/api/v1/sales/orders/2/invoices', () => HttpResponse.json(body, { status }))

const meta = {
  title: 'Sales/SalesOrderInvoiceForm',
  component: SalesOrderInvoiceForm,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/sales/[id].vue:171', 'إنشاء فاتورة مسودة من طلب مؤكد: الطلب كله أو دفعة مقدمة بنسبة أو بمبلغ، ولا يُعرض إلا ما يسمح به الخادم.'), msw: { handlers: { api: [made] } } },
  args: { order, invoicing: orderReadyToInvoice },
} satisfies Meta<typeof SalesOrderInvoiceForm>
export default meta
type Story = StoryObj<typeof meta>

export const Choose: Story = { name: 'اختيار ما يُفوتَر' }
export const WholeOrderOnly: Story = { name: 'الطلب كله فقط', args: { invoicing: { ...orderReadyToInvoice, can_down_payment: false } } }
export const DownPaymentOnly: Story = { name: 'دفعة مقدمة فقط', args: { invoicing: { ...orderReadyToInvoice, can_invoice: false } } }
export const AmountRefused: Story = { name: 'رفض الخادم للمبلغ', parameters: { msw: { handlers: { api: [refused(422, { code: 'invalid', message: 'bad', field: 'amount', details: { max_amount: 248.4 } })] } } } }
export const NothingLeft: Story = { name: 'لا شيء متبقٍ للفوترة', parameters: { msw: { handlers: { api: [refused(422, { code: 'nothing_to_invoice', message: 'nothing' })] } } } }
export const NoJournal: Story = { name: 'لا توجد يومية مبيعات', parameters: { msw: { handlers: { api: [refused(422, { code: 'no_journal', message: 'journal', field: 'journal_id' })] } } } }
export const Forbidden: Story = { name: 'بلا صلاحية', parameters: { msw: { handlers: { api: [refused(403, { code: 'forbidden', message: 'no' })] } } } }
