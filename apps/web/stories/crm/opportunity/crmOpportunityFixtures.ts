import type { CrmCall, CrmLostReason, CrmOpportunity, CrmOutcome, CrmPackage, CrmStage } from '@webvue/contracts'

export const stages: CrmStage[] = [
  { id: 1, name: 'جديد', sequence: 10, is_won: false, active: true },
  { id: 2, name: 'تم التواصل', sequence: 20, is_won: false, active: true },
  { id: 3, name: 'مهتم', sequence: 30, is_won: false, active: true },
  { id: 4, name: 'تم البيع', sequence: 40, is_won: true, active: true },
]

export const outcomes: CrmOutcome[] = [
  { id: 1, name: 'لا يرد', effect: 'follow_up', lost_reason_id: null, active: true },
  { id: 3, name: 'تم البيع', effect: 'won', lost_reason_id: null, active: true },
  { id: 4, name: 'غير مهتم', effect: 'lost', lost_reason_id: 1, active: true },
  { id: 5, name: 'رقم خاطئ', effect: 'lost', lost_reason_id: null, active: true },
]

export const lostReasons: CrmLostReason[] = [
  { id: 1, name: 'غير مهتم', active: true, protected: false },
  { id: 3, name: 'رقم خاطئ', active: true, protected: false },
]

export const packages: CrmPackage[] = [
  { id: 1, name: 'باقة أساسية', price: 120, description: '', active: true },
  { id: 2, name: 'باقة متقدمة', price: 280, description: '', active: true },
]

const base: CrmOpportunity = {
  id: 1, contact_name: 'أحمد العتيبي', phone: '0501234567', email: '', stage: { id: 1, name: 'جديد' }, user: { id: 3, name: 'ليلى الحربي' },
  source: { id: 1, name: 'الموقع' }, package: null, lost_reason: null, status: 'pending', list_price: 0, discount_percent: 0, final_price: 0, expected_revenue: 0,
  attempt_count: 0, next_call_at: null, cycle: 0, recycle_at: null, needs_manager: false, active: true, created_at: '2026-10-20T09:00:00Z',
}

export const opportunities: CrmOpportunity[] = [
  base,
  { ...base, id: 2, contact_name: 'سارة القحطاني', phone: '0507654321', stage: { id: 2, name: 'تم التواصل' }, next_call_at: '2026-10-29T09:00:00Z' },
  { ...base, id: 3, contact_name: 'نورة الزهراني', phone: '0559988776', user: null },
  { ...base, id: 4, contact_name: 'عبدالله المطيري', phone: '0566677889', stage: { id: 3, name: 'مهتم' }, needs_manager: true, attempt_count: 3 },
  { ...base, id: 5, contact_name: 'فهد الحربي', phone: '0533344556', stage: { id: 4, name: 'تم البيع' }, status: 'won', package: { id: 1, name: 'باقة أساسية' }, list_price: 120, discount_percent: 10, final_price: 108 },
]

export const calls: CrmCall[] = [
  { id: 2, outcome: { id: 1, name: 'لا يرد' }, note: 'رنّ الهاتف ولم يُجب', duration_minutes: 0, user: { id: 3, name: 'ليلى الحربي' }, created_at: '2026-10-27T10:30:00Z' },
  { id: 1, outcome: { id: 2, name: 'سيفكر' }, note: 'طلب مهلة حتى نهاية الأسبوع', duration_minutes: 4, user: { id: 3, name: 'ليلى الحربي' }, created_at: '2026-10-26T08:10:00Z' },
]
