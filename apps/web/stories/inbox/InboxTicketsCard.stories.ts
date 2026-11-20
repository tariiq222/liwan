import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import InboxTicketsCard from '../../app/components/inbox/InboxTicketsCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const capabilities = (...extra: string[]) => http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['inbox.conversations.read', 'helpdesk.tickets.read', ...extra] }))
const open = { id: 21, number: 'HD-0021', subject: 'تأخر توصيل الطلب', stage: { id: 1, name: 'جديدة', closed: false }, created_at: '2026-11-18T09:00:00' }
const closed = { id: 18, number: 'HD-0018', subject: 'استفسار عن الفاتورة', stage: { id: 4, name: 'مغلقة', closed: true }, created_at: '2026-11-02T09:00:00' }
const answer = (items: unknown[], ...extra: string[]) => ({ parameters: { msw: { handlers: { api: [
  capabilities(...extra),
  http.get('/api/v1/inbox/conversations/3/tickets', () => HttpResponse.json({ items, total: items.length })),
  http.post('/api/v1/inbox/conversations/3/tickets', () => HttpResponse.json({ code: 'conflict', message: 'open', details: { reason: 'open_ticket_exists' } }, { status: 409 })),
] } } } })

const meta = {
  title: 'Inbox/InboxTicketsCard',
  component: InboxTicketsCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/inbox/InboxContactPanel.vue:199', 'تذاكر الدعم التي رُفعت من المحادثة: الرقم والعنوان والمرحلة مع رابط التذكرة، ورفع تذكرة جديدة بعنوان واحد عندما لا توجد تذكرة مفتوحة.'),
    ...answer([], 'helpdesk.tickets.write').parameters,
  },
  args: { conversationId: 3 },
} satisfies Meta<typeof InboxTicketsCard>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { name: 'بلا تذاكر' }
export const OpenTicket: Story = { name: 'تذكرة مفتوحة', parameters: answer([open, closed], 'helpdesk.tickets.write').parameters }
export const AllClosed: Story = { name: 'كل التذاكر مغلقة', parameters: answer([closed], 'helpdesk.tickets.write').parameters }
export const ReadOnly: Story = { name: 'قراءة فقط', parameters: answer([closed]).parameters }
