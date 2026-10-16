import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { ProjectDetail } from '@webvue/contracts'
import CharterApprovalPanel from '../../app/components/pmo/projects/CharterApprovalPanel.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { projectDetail } from '../fixtures/pmo'
import { storyContext } from '../support/context'

// The approval state above the charter: one alert per state, with the actions
// each reader may take inline (no dialogs).
const sponsor = { id: 8, name: 'نورة' }

function withCharter(charter: Partial<ProjectDetail['charter']>, rest: Partial<ProjectDetail> = {}): ProjectDetail {
  return { ...projectDetail, ...rest, charter: { ...projectDetail.charter, sponsor, approval_required: true, ...charter } }
}

const meta = {
  title: 'Project/CharterApprovalPanel',
  component: CharterApprovalPanel,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/projects/[id]/charter.vue:57') },
  args: { project: withCharter({ state: 'draft' }) },
  render: args => ({
    components: { CharterApprovalPanel, PageContainer },
    setup: () => ({ args }),
    template: `<main class="webvue-shell-main"><PageContainer width="list"><CharterApprovalPanel v-bind="args" /></PageContainer></main>`,
  }),
} satisfies Meta<typeof CharterApprovalPanel>
export default meta
type Story = StoryObj<typeof meta>

export const Draft: Story = {
  name: 'مسودة',
  parameters: storyContext('apps/web/app/pages/projects/[id]/charter.vue:57', 'مسودة لم تُرسل بعد.'),
}
export const Returned: Story = {
  name: 'أعاده الراعي',
  args: { project: withCharter({ state: 'draft', return_note: 'أضف الميزانية التقديرية قبل إعادة الإرسال.' }) },
  parameters: storyContext('apps/web/app/pages/projects/[id]/charter.vue:57', 'تظهر ملاحظة الراعي فوق الميثاق.'),
}
export const WaitingForSponsor: Story = {
  name: 'بانتظار الراعي (منظور الراعي)',
  args: { project: withCharter({ state: 'submitted', can_review: true, submitted_by: { id: 2, name: 'Admin' }, submitted_at: '2026-10-15T09:00:00Z' }) },
  parameters: storyContext('apps/web/app/pages/projects/[id]/charter.vue:57', 'الراعي يعتمد أو يُرجع الميثاق مع ملاحظة تُكتب في مكانها.'),
}
export const WaitingManagerView: Story = {
  name: 'بانتظار الراعي (منظور المدير)',
  args: { project: withCharter({ state: 'submitted', submitted_by: { id: 2, name: 'Admin' }, submitted_at: '2026-10-15T09:00:00Z' }, { can_manage: true }) },
  parameters: storyContext('apps/web/app/pages/projects/[id]/charter.vue:57', 'المدير يستطيع سحب الطلب بتأكيد مضمّن.'),
}
export const Approved: Story = {
  name: 'معتمد',
  args: { project: withCharter({ state: 'approved', approved_by: sponsor, approved_at: '2026-10-15T10:00:00Z' }) },
  parameters: storyContext('apps/web/app/pages/projects/[id]/charter.vue:57', 'اسم المعتمِد وتاريخ الاعتماد.'),
}
