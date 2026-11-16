import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import HelpdeskMergeSection from '../../app/components/helpdesk/HelpdeskMergeSection.vue'
import { storyContext } from '../support/context'
import { tickets } from './helpdeskFixtures'

// The section searches the reachable tickets by number or subject and leaves the open one out of its own results.
const search = http.get('/api/v1/helpdesk/tickets', ({ request }) => {
  const q = new URL(request.url).searchParams.get('q') ?? ''
  const rows = tickets.filter(ticket => ticket.id !== 101 && (!q || ticket.subject.includes(q) || ticket.number.includes(q)))
  return HttpResponse.json({ items: rows, total: rows.length })
})

const meta = {
  title: 'Helpdesk/HelpdeskMergeSection',
  component: HelpdeskMergeSection,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/helpdesk/[id].vue:132', 'دمج التذاكر المكرّرة في التذكرة المفتوحة: بحث في التذاكر التي يصلها المستخدم، ومجموعة تُختار للدمج، وزر يدمج المحدد.'),
    msw: { handlers: { api: [search] } },
  },
  args: { ticketId: 101 },
} satisfies Meta<typeof HelpdeskMergeSection>
export default meta
type Story = StoryObj<typeof meta>

export const Candidates: Story = { name: 'تذاكر قابلة للدمج' }
