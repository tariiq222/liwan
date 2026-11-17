import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { delay, http, HttpResponse } from 'msw'
import type { HelpdeskTicketRow } from '@liwan/contracts'
import HelpdeskTicketDirectory from '../../app/components/helpdesk/HelpdeskTicketDirectory.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { storyContext } from '../support/context'
import { helpdeskMe, reference, tickets } from './helpdeskFixtures'

// The page reads its queue and filters from the URL, so each story starts on the address the app would show, and the
// list handler answers the queue and filters that address asks for, the way the server narrows the page.
const at = (path: string) => async () => { await __getRouter()!.replace(path); return {} }
const reader = http.get('/api/v1/me', () => HttpResponse.json(helpdeskMe(['helpdesk.tickets.read', 'helpdesk.tickets.write'])))
const referenceHandler = http.get('/api/v1/helpdesk/reference', () => HttpResponse.json(reference))
const list = (items: HelpdeskTicketRow[]) => http.get('/api/v1/helpdesk/tickets', ({ request }) => {
  const params = new URL(request.url).searchParams
  const state = params.get('state') ?? 'open'
  const q = params.get('q') ?? ''
  const rows = items.filter(ticket =>
    (state === 'all' || (state === 'closed') === ticket.stage.closed)
    && (!q || ticket.subject.includes(q) || ticket.number.includes(q))
    && (!params.get('team') || ticket.team?.id === Number(params.get('team')))
    && (!params.get('stage') || ticket.stage.id === Number(params.get('stage')))
    && (!params.get('priority') || ticket.priority === params.get('priority')))
  return HttpResponse.json({ items: rows, total: rows.length })
})

const meta = {
  title: 'Helpdesk/HelpdeskTicketDirectory',
  component: HelpdeskTicketDirectory,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/helpdesk/index.vue:17', 'بطاقة الدعم في «/helpdesk»: الطابور (المفتوحة والمغلقة والكل)، والبحث والفريق والمرحلة والأولوية والمسند إليه، والفلاتر في الرابط مع حالات الفراغ والخطأ وبلا صلاحية.'),
  },
} satisfies Meta<typeof HelpdeskTicketDirectory>
export default meta
type Story = StoryObj<typeof meta>

export const OpenQueue: Story = {
  name: 'الطابور المفتوح',
  loaders: [at('/helpdesk')],
  parameters: { msw: { handlers: { api: [reader, referenceHandler, list(tickets)] } } },
}
export const ClosedQueue: Story = {
  name: 'المغلقة',
  loaders: [at('/helpdesk?state=closed')],
  parameters: { msw: { handlers: { api: [reader, referenceHandler, list(tickets)] } } },
}
export const Filtered: Story = {
  name: 'مرشّحة بالبحث والأولوية',
  loaders: [at('/helpdesk?q=فاتورة&priority=medium')],
  parameters: { msw: { handlers: { api: [reader, referenceHandler, list(tickets)] } } },
}
export const Empty: Story = {
  name: 'لا تذاكر',
  loaders: [at('/helpdesk')],
  parameters: { msw: { handlers: { api: [reader, referenceHandler, list([])] } } },
}
export const NoResults: Story = {
  name: 'لا نتائج للبحث',
  loaders: [at('/helpdesk?q=طابعة')],
  parameters: { msw: { handlers: { api: [reader, referenceHandler, list(tickets)] } } },
}
export const Loading: Story = {
  name: 'يُحمَّل',
  loaders: [at('/helpdesk')],
  parameters: { msw: { handlers: { api: [reader, referenceHandler, http.get('/api/v1/helpdesk/tickets', async () => { await delay('infinite') })] } } },
}
export const Failed: Story = {
  name: 'فشل التحميل',
  loaders: [at('/helpdesk')],
  parameters: { msw: { handlers: { api: [reader, referenceHandler, http.get('/api/v1/helpdesk/tickets', () => HttpResponse.json({ code: 'unavailable', message: 'down' }, { status: 503 }))] } } },
}
export const Forbidden: Story = {
  name: 'بلا صلاحية',
  loaders: [at('/helpdesk')],
  parameters: { msw: { handlers: { api: [http.get('/api/v1/me', () => HttpResponse.json(helpdeskMe([]))), referenceHandler] } } },
}
export const CreateBackdrop: Story = {
  name: 'خلف لوحة الإنشاء',
  loaders: [at('/helpdesk/new?returnTo=%2Fhelpdesk%3Fstate%3Dclosed')],
  args: { background: true },
  parameters: { msw: { handlers: { api: [reader, referenceHandler, list(tickets)] } } },
}
