import type { Meta, StoryObj } from '@storybook/vue3-vite'
import MeetingMinutesDocument from '../../app/components/meetings/MeetingMinutesDocument.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const meeting = {
  name: 'اجتماع مراجعة المشروع',
  reference: 'MTG-0042',
  meeting_date: '2026-09-07',
  start_datetime: '2026-09-07T06:00:00Z',
  end_datetime: '2026-09-07T07:00:00Z',
  location: 'قاعة الاجتماعات الرئيسية',
  organizer: { name: 'سارة القحطاني' },
  secretary: { name: 'خالد الحربي' },
  attendees: [{ id: 3, name: 'سارة القحطاني' }, { id: 4, name: 'خالد الحربي' }, { id: 5, name: 'منى العتيبي' }],
}

const recommendations = [
  { id: 1, name: 'اعتماد خطة الإطلاق', result: 'تمت الموافقة', responsible: { name: 'منى العتيبي' }, deadline: '2026-09-21', execution_period: 'أسبوعان', project: { id: 2, name: 'مشروع ألفا' }, state: 'open' },
  { id: 2, name: 'تحديث سجل المخاطر', result: null, responsible: { name: 'خالد الحربي' }, deadline: '2026-09-14', execution_period: null, project: null, state: 'in_progress' },
]

const form = {
  opening: 'افتتح رئيس الاجتماع الجلسة ورحّب بالحضور.',
  closing: 'شكر رئيس الاجتماع الحضور وأُغلقت الجلسة.',
  chairperson: 'سارة القحطاني',
  approver_name: 'عبدالله الشمري',
  approver_title: 'مدير المشاريع',
  topics: [
    { key: 'topic-1', title: 'خطة الإطلاق', discussion: 'ناقش الحضور مراحل الإطلاق والمخاطر المحتملة.', project_id: 2, resolution_ids: [1] },
    { key: 'topic-2', title: 'المخاطر', discussion: 'استُعرض سجل المخاطر الحالي.', project_id: null, resolution_ids: [2] },
  ],
}

const meta = {
  title: 'Meetings/MeetingMinutesDocument',
  component: MeetingMinutesDocument,
  parameters: { layout: 'fullscreen' },
  args: { meeting, form, recommendations, legacyRecommendations: recommendations, legacyAgenda: '', legacyMinutes: '', snapshot: null, title: 'محضر الاجتماع', compact: false },
} satisfies Meta<typeof MeetingMinutesDocument>
export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = args => ({
  components: { MeetingMinutesDocument, PageContainer },
  setup: () => ({ args }),
  template: '<main class="webvue-shell-main"><PageContainer width="detail"><MeetingMinutesDocument v-bind="args" /></PageContainer></main>',
})

export const Structured: Story = {
  name: 'محضر منظّم',
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:217'),
  render,
}

export const Legacy: Story = {
  name: 'محضر نصي قديم',
  parameters: storyContext('apps/web/app/pages/meetings/[id]/print.vue:85'),
  args: { form: null, legacyAgenda: '<p>مراجعة خطة الإطلاق</p>', legacyMinutes: '<p>تمت الموافقة على الخطة بالإجماع.</p>' },
  render,
}

export const Empty: Story = {
  name: 'بلا مواضيع',
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:217'),
  args: { form: { ...form, topics: [] }, recommendations: [], legacyRecommendations: [] },
  render,
}

export const Compact: Story = {
  name: 'قراءة المحضر داخل الاجتماع',
  args: { compact: true },
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:217'),
  render,
}
