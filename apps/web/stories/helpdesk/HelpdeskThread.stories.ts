import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import HelpdeskThread from '../../app/components/helpdesk/HelpdeskThread.vue'
import { storyContext } from '../support/context'
import { threadAttachments, threadMessages } from './helpdeskFixtures'

const thread = (items: typeof threadMessages) => http.get('/api/v1/helpdesk/tickets/:id/messages', () => HttpResponse.json({ items, total: items.length }))

const meta = {
  title: 'Helpdesk/HelpdeskThread',
  component: HelpdeskThread,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/helpdesk/[id].vue:133', 'محادثة التذكرة: الردود العامة والملاحظات الداخلية بالترتيب الزمني، ومؤلّف يرسل أحدهما، والمرفقات بالرفع والتنزيل والحذف.'),
    msw: { handlers: { api: [thread(threadMessages)] } },
  },
  args: { ticketId: 101, attachments: threadAttachments, closed: false, canWrite: true, canRequest: false },
} satisfies Meta<typeof HelpdeskThread>
export default meta
type Story = StoryObj<typeof meta>

export const Conversation: Story = { name: 'محادثة ومرفقات' }
export const Empty: Story = {
  name: 'بلا ردود ولا مرفقات',
  args: { attachments: [] },
  parameters: { msw: { handlers: { api: [thread([])] } } },
}
export const Closed: Story = { name: 'مغلقة: لا إرفاق', args: { closed: true } }
export const RequesterOnly: Story = { name: 'مقدّم الطلب: بلا ملاحظة داخلية', args: { canWrite: false, canRequest: true } }
export const ReadOnly: Story = { name: 'قراءة فقط', args: { canWrite: false, canRequest: false } }
