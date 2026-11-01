import type { HrLeaveApprovalProcess } from '@liwan/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LeaveApprovalCard from '../../app/components/hr/LeaveApprovalCard.vue'
import { storyContext } from '../support/context'

const process: NonNullable<HrLeaveApprovalProcess['process']> = {
  id: 2, name: 'اعتماد الإجازات', revision: 1,
  steps: [
    { name: 'المدير المباشر', resolver: 'hr_leave_approver', resolver_label: 'المدير المباشر (معتمد الإجازات)', reviewers: [] },
    { name: 'الموارد البشرية', resolver: 'hr_leave_officers', resolver_label: 'مسؤولو الإجازات في الموارد البشرية', reviewers: [] },
  ],
}
const approval: HrLeaveApprovalProcess = { process, href: '/settings/apps/operations/processes/2', can_manage: true }
const meta = {
  title: 'HR/LeaveApprovalCard', component: LeaveApprovalCard,
  parameters: { ...storyContext('apps/web/app/pages/settings/apps/hr/index.vue:178', 'مراحل اعتماد الإجازات كما تقرؤها بطاقة إعدادات الموارد البشرية من مسار العمليات؛ التعديل في محرر العمليات.') },
  args: { approval },
} satisfies Meta<typeof LeaveApprovalCard>
export default meta
type Story = StoryObj<typeof meta>
export const Stages: Story = { name: 'مراحل محددة' }
export const NamedReviewers: Story = { args: { approval: { ...approval, process: { ...process, steps: [{ name: 'المدير', resolver: null, resolver_label: null, reviewers: [{ id: 1, user_id: 7, name: 'نورة العتيبي' }, { id: 2, user_id: 8, name: 'خالد الدوسري' }] }] } } } }
export const ReadOnly: Story = { args: { approval: { ...approval, can_manage: false } } }
export const NoProcess: Story = { name: 'لا توجد عملية', args: { approval: { process: null, href: '/settings/apps/operations/processes', can_manage: true } } }
export const NoProcessReadOnly: Story = { args: { approval: { process: null, href: '/settings/apps/operations/processes', can_manage: false } } }
