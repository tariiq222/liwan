import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { MeetingListItem } from '@nasq/contracts'
import MeetingTimeline from '../../app/components/meetings/MeetingTimeline.vue'
import PageContainer from '../../app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const organizer = { id: 3, name: 'سارة القحطاني' }
const meetings: MeetingListItem[] = [
  { id: 41, name: 'اجتماع المتابعة الأسبوعي', reference: 'MTG-0041', meeting_date: '2026-08-31', start_datetime: '2026-08-31T06:00:00Z', end_datetime: '2026-08-31T07:00:00Z', state: 'done', organizer, open_resolution_count: 0, series_id: 5, project_id: null },
  { id: 42, name: 'اجتماع المتابعة الأسبوعي', reference: 'MTG-0042', meeting_date: '2026-09-07', start_datetime: '2026-09-07T06:00:00Z', end_datetime: '2026-09-07T07:00:00Z', state: 'done', organizer, open_resolution_count: 2, series_id: 5, project_id: null },
  { id: 43, name: 'اجتماع المتابعة الأسبوعي', reference: 'MTG-0043', meeting_date: '2026-09-14', start_datetime: '2026-09-14T06:00:00Z', end_datetime: '2026-09-14T07:00:00Z', state: 'confirmed', organizer, open_resolution_count: 0, series_id: 5, project_id: null },
  { id: 44, name: 'اجتماع المتابعة الأسبوعي', reference: 'MTG-0044', meeting_date: '2026-09-21', start_datetime: null, end_datetime: null, state: 'draft', organizer: null, open_resolution_count: 0, series_id: 5, project_id: null },
]

const meta = {
  title: 'Meetings/MeetingTimeline',
  component: MeetingTimeline,
  parameters: { layout: 'fullscreen' },
  args: { meetings, nextMeetingId: 43, view: 'timeline', preserveOrder: false, returnTo: '/meetings/series/5', now: new Date('2026-09-10T08:00:00Z') },
} satisfies Meta<typeof MeetingTimeline>
export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = args => ({
  components: { MeetingTimeline, PageContainer },
  setup: () => ({ args }),
  template: '<main class="nasq-shell-main"><PageContainer width="detail"><MeetingTimeline v-bind="args" /></PageContainer></main>',
})

export const Timeline: Story = {
  name: 'خط زمني',
  parameters: storyContext('apps/web/app/pages/meetings/series/[id].vue:269'),
  render,
}

export const Table: Story = {
  name: 'جدول',
  parameters: storyContext('apps/web/app/pages/meetings/series/[id].vue:269'),
  args: { view: 'table', preserveOrder: true },
  render,
}

export const Empty: Story = {
  name: 'بلا لقاءات',
  parameters: storyContext('apps/web/app/pages/meetings/series/[id].vue:269'),
  args: { meetings: [], nextMeetingId: null },
  render,
}
