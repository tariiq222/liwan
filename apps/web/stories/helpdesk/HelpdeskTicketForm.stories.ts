import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import HelpdeskTicketForm from '../../app/components/helpdesk/HelpdeskTicketForm.vue'
import { storyContext } from '../support/context'
import { customerPicks, helpdeskMe, reference, ticketDetail } from './helpdeskFixtures'

const writer = http.get('/api/v1/me', () => HttpResponse.json(helpdeskMe(['helpdesk.tickets.read', 'helpdesk.tickets.write'])))
const referenceHandler = http.get('/api/v1/helpdesk/reference', () => HttpResponse.json(reference))
const customers = http.get('/api/v1/customers/pick', () => HttpResponse.json({ items: customerPicks, total: customerPicks.length }))

const meta = {
  title: 'Helpdesk/HelpdeskTicketForm',
  component: HelpdeskTicketForm,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/helpdesk/new.vue:22', 'نموذج فتح التذكرة في لوحة المسار وتعديل التذكرة: الموضوع والوصف والفريق والأولوية والتصنيف والنوع والقناة، والعميل حين يفتح الوكيل التذكرة له.'),
    msw: { handlers: { api: [writer, referenceHandler, customers] } },
  },
  args: { backTo: '/helpdesk' },
} satisfies Meta<typeof HelpdeskTicketForm>
export default meta
type Story = StoryObj<typeof meta>

export const Create: Story = { name: 'تذكرة جديدة' }
export const ForCustomer: Story = { name: 'فتحها وكيل لعميل', args: { forCustomer: true } }
export const Edit: Story = { name: 'تعديل تذكرة', args: { ticket: ticketDetail, backTo: '/helpdesk/101' } }
export const WithoutReference: Story = {
  name: 'لا فرق ولا تصنيفات بعد',
  parameters: { msw: { handlers: { api: [writer, http.get('/api/v1/helpdesk/reference', () => HttpResponse.json({ teams: [], stages: [], categories: [], types: [], channels: [], tags: [] })), customers] } } },
}
