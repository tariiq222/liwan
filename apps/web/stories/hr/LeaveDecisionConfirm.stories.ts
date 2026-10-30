import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { HrLeave } from '@liwan/contracts'
import LeaveDecisionConfirm from '../../app/components/hr/LeaveDecisionConfirm.vue'
import { storyContext } from '../support/context'

// التأكيد الداخلي لرفض الإجازة أو إلغائها أو سحب طلبها: يسمّي الموظف والفترة، ويطلب سببًا
// اختياريًا للرفض والإلغاء فقط. لا يرسل طلبًا؛ القيمة تعود عبر `confirm`.
const leave: HrLeave = {
  id: 12, employee: { id: 4, name: 'سارة القحطاني' }, leave_type: { id: 2, name: 'إجازة سنوية' },
  date_from: '2026-11-02', date_to: '2026-11-06', number_of_days: 5, state: 'confirm', notes: '',
  can_approve: true, can_refuse: true, can_cancel: false, can_withdraw: true, cancellation_policy: 'manager_approval', cancellation: null, can_request_cancellation: false, can_approve_cancellation: false, can_refuse_cancellation: false,
}

const meta = {
  title: 'HR/LeaveDecisionConfirm',
  component: LeaveDecisionConfirm,
  parameters: storyContext('apps/web/app/components/hr/LeaveList.vue:217', 'تحت شريط الأخطاء وقبل بطاقة القائمة، وفي مكوّن سجل الإجازة تحت الترويسة.'),
  args: { leave, kind: 'refuse', pending: false },
} satisfies Meta<typeof LeaveDecisionConfirm>
export default meta
type Story = StoryObj<typeof meta>

export const Refuse: Story = { name: 'رفض مع سبب اختياري' }
export const Cancel: Story = { name: 'إلغاء إجازة', args: { kind: 'cancel' } }
export const Withdraw: Story = { name: 'سحب الطلب بلا سبب', args: { kind: 'withdraw' } }

export const RequestCancellation: Story = { args: { kind: 'requestCancellation' } }
export const ApproveCancellation: Story = { args: { kind: 'approveCancellation' } }
export const RefuseCancellation: Story = { args: { kind: 'refuseCancellation' } }
export const ManagerCancellation: Story = { args: { kind: 'managerCancel' } }
