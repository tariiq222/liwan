import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import HelpdeskOpportunityCard from '../../app/components/helpdesk/HelpdeskOpportunityCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const readOnly = ['crm.leads.read', 'helpdesk.tickets.read']
const writer = [...readOnly, 'helpdesk.tickets.write']
const access = (capabilities: string[]) => http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities }))
const ref = { id: 9, contact_name: 'منى العتيبي', stage: { id: 2, name: 'تم التواصل' }, status: 'won', active: true }
const answer = (body: unknown, capabilities = writer) => ({ parameters: { msw: { handlers: { api: [access(capabilities), http.get('/api/v1/helpdesk/tickets/4/opportunity', () => HttpResponse.json(body))] } } } })

const meta = {
  title: 'Helpdesk/HelpdeskOpportunityCard',
  component: HelpdeskOpportunityCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/helpdesk/[id].vue:123', 'فرصة المبيعات المرتبطة بالتذكرة: الاسم والمرحلة والحالة مع رابط الفرصة، وتغييرها أو فك الربط لمن يملك صلاحية كتابة التذكرة، أو ربط فرصة موجودة بالبحث. الفرصة التي لا يراها المستخدم لا تُسمّى.'),
    ...answer({ opportunity: null, hidden: false }).parameters,
  },
  args: { ticketId: 4 },
} satisfies Meta<typeof HelpdeskOpportunityCard>
export default meta
type Story = StoryObj<typeof meta>

export const NotLinked: Story = { name: 'غير مرتبطة' }
export const Linked: Story = { name: 'مرتبطة', parameters: answer({ opportunity: ref, hidden: false }).parameters }
export const Archived: Story = { name: 'فرصة مؤرشفة', parameters: answer({ opportunity: { ...ref, active: false }, hidden: false }).parameters }
export const Hidden: Story = { name: 'فرصة لا يراها المستخدم', parameters: answer({ opportunity: null, hidden: true }).parameters }
export const ReadOnly: Story = { name: 'قراءة فقط', parameters: answer({ opportunity: ref, hidden: false }, readOnly).parameters }
