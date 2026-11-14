import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesOrderForm from '../../app/components/sales/SalesOrderForm.vue'
import { storyContext } from '../support/context'
import { SALES_ALL, customerPicks, draftOrder, meWith, salespeople } from './salesFixtures'

const session = (capabilities: string[]) => http.get('/api/v1/me', () => HttpResponse.json(meWith([...capabilities, 'products.read'])))
const picks = [http.get('/api/v1/customers/pick', () => HttpResponse.json({ items: customerPicks, total: customerPicks.length })), http.get('/api/v1/sales/salespeople', () => HttpResponse.json(salespeople))]
const handlers = (capabilities: string[], ...extra: ReturnType<typeof http.get>[]) => ({ msw: { handlers: { api: [session(capabilities), ...picks, ...extra] } } })
const agent = ['sales.read', 'sales.quotations.manage', 'sales.orders.confirm']
const refuse = (status: number, body: object) => handlers(agent, http.patch('/api/v1/sales/orders/1', () => HttpResponse.json(body, { status })))

const meta = {
  title: 'Sales/SalesOrderForm',
  component: SalesOrderForm,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/sales/new.vue:19', 'نموذج عرض السعر: العميل والمندوب والصلاحية والشروط والبنود. لا يرسل سعرًا ولا ضريبة.'), ...handlers(SALES_ALL) },
  args: { backTo: '/sales' },
} satisfies Meta<typeof SalesOrderForm>
export default meta
type Story = StoryObj<typeof meta>

export const New: Story = { name: 'عرض سعر جديد (مدير)' }
export const NewAgent: Story = { name: 'عرض سعر جديد (مندوب)', parameters: handlers(agent) }
export const Edit: Story = { name: 'تعديل', args: { order: draftOrder }, parameters: handlers(agent) }
export const DiscountRefused: Story = { name: 'خصم أعلى من الحد', args: { order: draftOrder }, parameters: refuse(403, { code: 'forbidden', message: 'discount', field: 'lines.1.discount_percent', details: { reason: 'discount_above_limit' } }) }
export const CustomerRefused: Story = { name: 'عميل غير صالح', args: { order: draftOrder }, parameters: refuse(422, { code: 'invalid', message: 'bad', field: 'customer_id' }) }
