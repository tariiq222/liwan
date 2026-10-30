import type { Meta, StoryObj } from '@storybook/vue3-vite'
import MeetingEventList from '../../app/components/meetings/MeetingEventList.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const events = [
  { id: 1, meeting_id: 7, meeting_name: 'اجتماع المتابعة الأسبوعي', occurred_at: '2026-09-07T06:00:00Z', actor: { id: 3, name: 'سارة القحطاني' }, kind: 'created', summary: 'Meeting created' },
  { id: 2, meeting_id: 7, meeting_name: 'اجتماع المتابعة الأسبوعي', occurred_at: '2026-09-07T08:30:00Z', actor: { id: 4, name: 'خالد الحربي' }, kind: 'updated', summary: 'تم نقل الموعد إلى الساعة العاشرة صباحًا' },
  { id: 3, meeting_id: 7, meeting_name: 'اجتماع المتابعة الأسبوعي', occurred_at: '2026-09-08T09:15:00Z', actor: null, kind: 'state_changed', summary: 'Meeting state changed to confirmed' },
]

const meta = {
  title: 'Meetings/MeetingEventList',
  component: MeetingEventList,
  parameters: { layout: 'fullscreen' },
  args: { events, loading: false, error: null, total: 3, page: 1, pageSize: 25 },
} satisfies Meta<typeof MeetingEventList>
export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = args => ({
  components: { MeetingEventList, PageContainer },
  setup: () => ({ args }),
  template: '<main class="liwan-shell-main"><PageContainer width="detail"><MeetingEventList v-bind="args" /></PageContainer></main>',
})

export const Populated: Story = {
  name: 'سجل الأحداث',
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:253'),
  render,
}

export const Paginated: Story = {
  name: 'سجل بصفحات متعددة',
  parameters: storyContext('apps/web/app/pages/meetings/series/[id].vue:369'),
  args: { total: 60, pageSize: 3 },
  render,
}

export const Empty: Story = {
  name: 'بلا أحداث',
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:253'),
  args: { events: [], total: 0 },
  render,
}

export const Loading: Story = {
  name: 'جارٍ التحميل',
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:253'),
  args: { events: [], total: 0, loading: true },
  render,
}
