import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import MeetingAttachmentsTab from '../../app/components/meetings/MeetingAttachmentsTab.vue'
import { apiHandlers } from '../handlers/api'
import { storyContext } from '../support/context'

const attachments = [
  { id: 1, name: 'جدول الأعمال.pdf', mimetype: 'application/pdf', url: '/web/content/1' },
  { id: 2, name: 'عرض المشروع.pptx', mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', url: '/web/content/2' },
]
const listing = (items: typeof attachments) => [
  http.get('/api/v1/meetings/:id/attachments', () => HttpResponse.json({ items, total: items.length })),
  ...apiHandlers,
]

const meta = {
  title: 'Meetings/MeetingAttachmentsTab',
  component: MeetingAttachmentsTab,
  parameters: { ...storyContext('apps/web/app/pages/meetings/[id].vue:290'), msw: { handlers: { api: listing(attachments) } } },
  args: { meetingId: 7, canEdit: true },
} satisfies Meta<typeof MeetingAttachmentsTab>
export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'مع رفع وحذف' }

export const ReadOnly: Story = {
  name: 'للقراءة فقط',
  args: { canEdit: false },
}

export const Empty: Story = {
  name: 'بلا مرفقات',
  parameters: { msw: { handlers: { api: listing([]) } } },
}
