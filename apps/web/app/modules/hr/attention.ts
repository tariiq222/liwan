import { HrLeaveListSchema } from '@webvue/contracts'
import { formatDate, isolateLtr } from '@webvue/ui/app/utils/formatDate'
import { ATTENTION_ROWS_PER_PROVIDER } from '../../composables/nav/attentionModel'
import { HR_LEAVE_PENDING_STATES } from '../../composables/useHrLeave'
import type { AppAttentionProvider } from '../types'

const PAGE = 50

/** Leave requests in the page's own pending queue that I can approve. Leave only: payroll and compensation data never appear here. */
export const leaveApprovalAttention: AppAttentionProvider = {
  id: 'hr-leave-approvals',
  module: 'hr',
  work: 'decide',
  capability: 'hr.leave.approve',
  queryKey: ['hr', 'leave', 'attention', 'approvals'],
  async load(api) {
    const page = await api('/api/v1/hr/leave/requests', { query: { state: HR_LEAVE_PENDING_STATES.join(','), limit: PAGE }, schema: HrLeaveListSchema })
    return page.items
      .filter(leave => leave.can_approve)
      .slice(0, ATTENTION_ROWS_PER_PROVIDER)
      .map(leave => ({
        id: `leave-${leave.id}`,
        label: `${leave.employee.name} · ${leave.leave_type.name}`,
        to: `/hr/leave/${leave.id}`,
        caption: isolateLtr(`${formatDate(leave.date_from)} - ${formatDate(leave.date_to)}`),
        tone: 'urgent' as const,
      }))
  },
}

/** Pending cancellation decisions use their own queue, including stale requests a manager can refuse. */
export const leaveCancellationAttention: AppAttentionProvider = {
  id: 'hr-leave-cancellations',
  module: 'hr',
  work: 'decide',
  capability: 'hr.leave.approve',
  queryKey: ['hr', 'leave', 'attention', 'cancellations'],
  async load(api, t) {
    const page = await api('/api/v1/hr/leave/requests', { query: { cancellation_state: 'pending', limit: PAGE }, schema: HrLeaveListSchema })
    return page.items
      .filter(leave => leave.cancellation?.state === 'pending' && (leave.can_approve_cancellation || leave.can_refuse_cancellation))
      .slice(0, ATTENTION_ROWS_PER_PROVIDER)
      .map(leave => ({
        id: `leave-cancellation-${leave.id}`,
        label: `${t('hr.leave.cancellationStates.pending')} · ${leave.employee.name} · ${leave.leave_type.name}`,
        to: `/hr/leave/${leave.id}?returnTo=${encodeURIComponent('/hr/leave?cancellation_state=pending')}`,
        caption: isolateLtr(`${formatDate(leave.date_from)} - ${formatDate(leave.date_to)}`),
        tone: 'urgent' as const,
      }))
  },
}
