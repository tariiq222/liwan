import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { MeetingDetail } from '@liwan/contracts'
import MeetingResolutionsTab from '../../app/components/meetings/MeetingResolutionsTab.vue'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const resolution = (id: number, overrides: Partial<MeetingDetail['resolutions'][number]>): MeetingDetail['resolutions'][number] => ({
  id, name: `توصية ${id}`, deadline: '2026-11-15', priority: '1', state: 'open', responsible: { id: 4, name: 'خالد العتيبي' },
  task_id: null, result: '<p>اعتماد الخطة وإبلاغ الفرق المعنية.</p>', can_update_execution: true, can_edit_decision: true,
  allowed_actions: ['start', 'cancel'], ...overrides,
})

const meeting: MeetingDetail = {
  id: 7, name: 'اجتماع المتابعة الأسبوعي', reference: 'MTG-0007', meeting_date: '2026-10-20', start_datetime: null, end_datetime: null,
  state: 'confirmed', organizer: { id: 2, name: 'سارة القحطاني' }, open_resolution_count: 2, series_id: null, project_id: null,
  agenda: '', minutes: '', location: '', meeting_url: '', can_edit: true, can_manage: true, secretary: null, attendees: [], series: null, project: null,
  resolutions: [
    resolution(1, {}),
    resolution(2, { state: 'in_progress', allowed_actions: ['complete', 'cancel'] }),
    resolution(3, { state: 'done', allowed_actions: ['reopen'], task_id: 31 }),
  ],
  previous_resolutions: [{ ...resolution(9, { state: 'done', allowed_actions: [] }), meeting_id: 5, meeting_name: 'اجتماع الأسبوع الماضي' }],
}

const meta = {
  title: 'Meetings/MeetingResolutionsTab',
  component: MeetingResolutionsTab,
  parameters: { ...storyContext('apps/web/app/pages/meetings/[id].vue:295'), msw: { handlers: { api: shellHandlers } } },
  args: { meeting, meetingId: 7 },
} satisfies Meta<typeof MeetingResolutionsTab>
export default meta
type Story = StoryObj<typeof meta>

export const WithResolutions: Story = { name: 'توصيات بحالات مختلفة' }

export const Empty: Story = {
  name: 'بلا توصيات',
  args: { meeting: { ...meeting, resolutions: [], previous_resolutions: [], open_resolution_count: 0 } },
}
