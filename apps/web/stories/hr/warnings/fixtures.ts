import type { HrWarning } from '@liwan/contracts'

// Static fixtures for the warning stories: no requests are made.
export const warningFixture = (over: Partial<HrWarning> = {}): HrWarning => ({
  id: 5,
  employee: { id: 7, name: 'ليلى الحربي' },
  type: { id: 2, name: 'إنذار كتابي', severity: 2 },
  date_issued: '2026-10-12',
  reason: 'تأخر عن الدوام ثلاث مرات خلال أسبوع واحد دون إشعار مسبق.',
  corrective_action: 'الالتزام بساعات الدوام وإشعار المدير قبل أي تأخر.',
  state: 'issued',
  acknowledgement: 'required',
  ack_pending: true,
  issued_by: { id: 1, name: 'هالة السبيعي' },
  issued_at: '2026-10-12T08:30:00Z',
  acknowledged_at: null,
  contested_at: null,
  contest_note: null,
  withdrawn_by: null,
  withdrawn_at: null,
  withdraw_reason: null,
  revision: 2,
  ...over,
})

export const warningTypesFixture = [
  { id: 1, name: 'إنذار شفهي', severity: 1, active: true, revision: 1 },
  { id: 2, name: 'إنذار كتابي', severity: 2, active: true, revision: 1 },
  { id: 3, name: 'إنذار نهائي', severity: 3, active: false, revision: 2 },
]

export const warningSettingsFixture = {
  warnings_issued_by: 'hr_only' as const,
  warnings_employee_acknowledgement: 'required' as const,
  warnings_escalation_window_months: 12,
  revision: 1,
}
