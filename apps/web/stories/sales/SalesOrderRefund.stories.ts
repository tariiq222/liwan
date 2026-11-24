import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesOrderRefund from '../../app/components/sales/SalesOrderRefund.vue'
import { storyContext } from '../support/context'
import { draftOrder, orderPayment } from './salesFixtures'

const payment = { ...orderPayment, amount_received: 99.36, amount_due: 0, status: 'cancelled', held: 'cancelled', amount_to_refund: 99.36, amount_refundable: 99.36, can_refund: true } as const
const order = { ...draftOrder, payment }
const record = http.post('/api/v1/sales/orders/1/refunds', () => HttpResponse.json({ ...order, payment: { ...payment, amount_received: 49.36, amount_refundable: 49.36 } }))
const refused = (status: number, body: object) => http.post('/api/v1/sales/orders/1/refunds', () => HttpResponse.json(body, { status }))

const meta = {
  title: 'Sales/SalesOrderRefund',
  component: SalesOrderRefund,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/sales/[id].vue:170', 'تسجيل رد مبلغ أُجري فعلًا من لوحة بوابة الدفع: المبلغ (حتى المتاح) ومرجع الرد.'), msw: { handlers: { api: [record] } } },
  args: { order, payment },
} satisfies Meta<typeof SalesOrderRefund>
export default meta
type Story = StoryObj<typeof meta>

export const Record: Story = { name: 'تسجيل الرد' }
export const AmountRefused: Story = { name: 'رفض الخادم للمبلغ', parameters: { msw: { handlers: { api: [refused(422, { code: 'invalid', message: 'bad', field: 'amount' })] } } } }
export const Repeated: Story = { name: 'دفعة لم تُسجَّل أو رد مكرر', parameters: { msw: { handlers: { api: [refused(409, { code: 'conflict', message: 'conflict' })] } } } }
export const Forbidden: Story = { name: 'بلا صلاحية', parameters: { msw: { handlers: { api: [refused(403, { code: 'forbidden', message: 'no' })] } } } }
