import type { HrLeave } from '@liwan/contracts'
import { http, HttpResponse } from 'msw'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LeaveRecord from '../../app/components/hr/LeaveRecord.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { storyContext } from '../support/context'
import { leave, hrSelfServiceHandlers } from './selfServiceFixtures'

const meta = {
  title: 'HR/LeaveRecord', component: LeaveRecord,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/hr/self/leave/[leaveId].vue:6', 'سجل الطلب الشخصي يستخدم واجهة الموظف نفسه ولا يعرض إجراءات الاعتماد، ويعيد استخدام سجل الإجازة الإداري.'), msw: { handlers: { api: hrSelfServiceHandlers } } },
  args: { personal: true },
  loaders: [async context => {
    const router = __getRouter()
    if (!router) return
    if (!router.hasRoute('hr-self-service-story')) router.addRoute({ name: 'hr-self-service-story', path: '/account/leave/:leaveId', component: { render: () => null } })
    if (!router.hasRoute('hr-leave-story')) router.addRoute({ name: 'hr-leave-story', path: '/hr/leave/:leaveId', component: { render: () => null } })
    await router.replace(context.args.personal ? '/account/leave/12' : '/hr/leave/12')
  }],
} satisfies Meta<typeof LeaveRecord>
export default meta
type Story = StoryObj<typeof meta>
export const Personal: Story = { name: 'سجل طلب إجازتي' }
export const Management: Story = { name: 'سجل الاعتماد الإداري', args: { personal: false } }

const pending = { id: 8, state: 'pending' as const, revision: 1, reason: 'تغيّرت خطة السفر', requested_at: '2026-10-23 12:00:00', initiator: { id: 2, name: 'سارة القحطاني' }, reviewed_at: null, reviewer: null, review_reason: null }
function cancellationStory(overrides: Partial<HrLeave>, personal = true): Story {
  const record: HrLeave = { ...leave, state: 'validate', can_withdraw: false, can_request_cancellation: true, ...overrides }
  return { args: { personal }, parameters: { msw: { handlers: { api: [
    http.get('/api/v1/hr/leave/me/:id', () => HttpResponse.json(record)),
    http.get('/api/v1/hr/leave/requests/:id', () => HttpResponse.json(record)),
    ...hrSelfServiceHandlers,
  ] } } } }
}
export const ApprovedRequestable = cancellationStory({})
export const CancellationPending = cancellationStory({ cancellation: pending, can_request_cancellation: false })
export const CancellationRefused = cancellationStory({ cancellation: { ...pending, state: 'refused', revision: 2, reviewer: { id: 3, name: 'نورة العتيبي' }, reviewed_at: '2026-10-23 13:00:00', review_reason: 'احتياج الفريق' } })
export const ManagerOnly = cancellationStory({ cancellation_policy: 'manager_only', can_request_cancellation: false })
export const EmployeeDirect = cancellationStory({ cancellation_policy: 'direct_employee', can_request_cancellation: false, can_cancel: true })
export const ManagerDirect = cancellationStory({ can_request_cancellation: false, can_cancel: true }, false)
export const CancellationDecision = cancellationStory({ cancellation: pending, can_request_cancellation: false, can_approve_cancellation: true, can_refuse_cancellation: true }, false)
export const StaleConflict: Story = { ...CancellationDecision, parameters: { msw: { handlers: { api: [
  http.post('/api/v1/hr/leave/requests/:id/cancellation/approve', () => HttpResponse.json({ code: 'conflict', message: 'تغيّرت الإجازة' }, { status: 409 })),
  http.get('/api/v1/hr/leave/requests/:id', () => HttpResponse.json({ ...leave, state: 'validate', can_withdraw: false, cancellation: pending, can_approve_cancellation: true, can_refuse_cancellation: true })),
  ...hrSelfServiceHandlers,
] } } } }
export const Forbidden: Story = { parameters: { msw: { handlers: { api: [http.get('/api/v1/hr/leave/me/:id', () => HttpResponse.json({ code: 'forbidden', message: 'ليس لديك صلاحية' }, { status: 403 })), ...hrSelfServiceHandlers] } } } }
