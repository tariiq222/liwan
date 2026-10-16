import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import MeetingMinutesForm from '../../app/components/meetings/MeetingMinutesForm.vue'
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
  attendees: [{ id: 3, name: 'سارة القحطاني' }, { id: 4, name: 'خالد الحربي' }],
}

const recommendations = [
  { id: 1, name: 'اعتماد خطة الإطلاق', responsible: { name: 'منى العتيبي' }, deadline: '2026-09-21', state: 'open' },
  { id: 2, name: 'تحديث سجل المخاطر', responsible: { name: 'خالد الحربي' }, deadline: '2026-09-14', state: 'in_progress' },
]

const filled = {
  opening: 'افتتح رئيس الاجتماع الجلسة ورحّب بالحضور.',
  closing: 'شكر رئيس الاجتماع الحضور.',
  chairperson: 'سارة القحطاني',
  approver_name: 'عبدالله الشمري',
  approver_title: 'مدير المشاريع',
  topics: [
    { key: 'topic-1', title: 'خطة الإطلاق', discussion: 'ناقش الحضور مراحل الإطلاق.', project_id: null, resolution_ids: [1] },
    { key: 'topic-2', title: 'المخاطر', discussion: 'استُعرض سجل المخاطر الحالي.', project_id: null, resolution_ids: [] },
  ],
}

const meta = {
  title: 'Meetings/MeetingMinutesForm',
  component: MeetingMinutesForm,
  parameters: { layout: 'fullscreen' },
  args: { modelValue: filled, meeting, recommendations, legacyAgenda: '', readonly: false, pending: false },
} satisfies Meta<typeof MeetingMinutesForm>
export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = args => ({
  components: { MeetingMinutesForm, PageContainer },
  setup: () => ({ args, value: ref(args.modelValue) }),
  template: '<main class="webvue-shell-main"><PageContainer width="form"><MeetingMinutesForm v-model="value" :meeting="args.meeting" :recommendations="args.recommendations" :legacy-agenda="args.legacyAgenda" :readonly="args.readonly" :pending="args.pending" /></PageContainer></main>',
})

export const Populated: Story = {
  name: 'نموذج معبّأ',
  parameters: storyContext('apps/web/app/pages/meetings/[id]/minutes.vue:119'),
  render,
}

export const Empty: Story = {
  name: 'نموذج فارغ',
  parameters: storyContext('apps/web/app/pages/meetings/[id]/minutes.vue:119'),
  args: { modelValue: { opening: '', closing: '', chairperson: '', approver_name: '', approver_title: '', topics: [] }, legacyAgenda: '<p>جدول أعمال سابق</p>' },
  render,
}

export const Pending: Story = {
  name: 'أثناء الحفظ',
  parameters: storyContext('apps/web/app/pages/meetings/[id]/minutes.vue:119'),
  args: { pending: true },
  render,
}

export const ReadOnly: Story = {
  name: 'للقراءة فقط',
  parameters: storyContext('apps/web/app/pages/meetings/[id]/minutes.vue:119'),
  args: { readonly: true },
  render,
}
