import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesOrderAssign from '../../app/components/sales/SalesOrderAssign.vue'
import { storyContext } from '../support/context'
import { draftOrder, salespeople } from './salesFixtures'

const people = http.get('/api/v1/sales/salespeople', () => HttpResponse.json({ items: salespeople, total: salespeople.length }))
const meta = {
  title: 'Sales/SalesOrderAssign',
  component: SalesOrderAssign,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/sales/[id].vue:112', 'تغيير مندوب المستند لمن يملك صلاحية التعيين.'),
    msw: { handlers: { api: [people, http.post('/api/v1/sales/orders/1/assign', () => HttpResponse.json(draftOrder))] } },
  },
  args: { order: draftOrder },
} satisfies Meta<typeof SalesOrderAssign>
export default meta
type Story = StoryObj<typeof meta>

export const Assign: Story = { name: 'تغيير المندوب' }
export const Refused: Story = { name: 'رفض الخادم', parameters: { msw: { handlers: { api: [people, http.post('/api/v1/sales/orders/1/assign', () => HttpResponse.json({ code: 'forbidden', message: 'no' }, { status: 403 }))] } } } }
