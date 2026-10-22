import { http, HttpResponse } from 'msw'
import type { HrEmployee, HrLeave } from '@webvue/contracts'
import { me } from '../fixtures/pmo'

export const employee: HrEmployee = {
  id: 4, name: 'سارة القحطاني', job_title: 'أخصائية موارد بشرية', department: { id: 2, name: 'الموارد البشرية' },
  work_email: 'sara@example.com', work_phone: '+966500000000', user_id: 2, manager: { id: 3, name: 'نورة العتيبي' },
  active: true, access: null, contract: null,
}
export const leave: HrLeave = {
  id: 12, employee: { id: 4, name: employee.name }, leave_type: { id: 2, name: 'إجازة سنوية' },
  date_from: '2026-11-02', date_to: '2026-11-06', number_of_days: 5, state: 'confirm', notes: 'إجازة عائلية',
  can_approve: false, can_refuse: false, can_cancel: false, can_withdraw: true,
}
export const hrSelfServiceHandlers = [
  http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['hr.employees.read', 'hr.leave.read', 'hr.leave.request', 'hr.leave.manage', 'hr.leave.approve'] })),
  http.get('/api/v1/hr/me', () => HttpResponse.json(employee)),
  http.get('/api/v1/hr/leave/balances', () => HttpResponse.json({ items: [{ leave_type: leave.leave_type, allocated: 21, taken: 4, pending: 5, remaining: 12 }], total: 1 })),
  http.get('/api/v1/hr/leave/requests', () => HttpResponse.json({ items: [leave], total: 1 })),
  http.get('/api/v1/hr/leave/me/:id', () => HttpResponse.json(leave)),
  http.get('/api/v1/hr/leave/requests/:id', () => HttpResponse.json({ ...leave, can_approve: true, can_refuse: true })),
]
