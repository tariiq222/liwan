import type { CrmDashboard, CrmOpportunity } from '@liwan/contracts'

const base: CrmOpportunity = {
  id: 1, contact_name: 'أحمد العتيبي', phone: '0501234567', email: '', stage: { id: 1, name: 'جديد' }, user: { id: 3, name: 'ليلى الحربي' },
  source: { id: 1, name: 'الموقع' }, package: null, lost_reason: null, status: 'pending', list_price: 0, discount_percent: 0, final_price: 0, expected_revenue: 0,
  attempt_count: 1, next_call_at: '2026-10-28T09:00:00Z', cycle: 0, recycle_at: null, needs_manager: false, active: true, created_at: '2026-10-20T09:00:00Z',
}

export const opportunities: CrmOpportunity[] = [
  base,
  { ...base, id: 2, contact_name: 'هند الشهري', phone: '0522200111', next_call_at: '2026-10-28T11:00:00Z' },
]

type Manager = NonNullable<CrmDashboard['manager']>

export const sourcesBlock: Manager['conversion_by_source'] = [
  { source_id: 1, name: 'الموقع', total: 40, won: 12 },
  { source_id: 2, name: 'معرض', total: 25, won: 4 },
  { source_id: null, name: '', total: 6, won: 0 },
]

export const agentsBlock: Manager['agents'] = [
  { user_id: 3, name: 'ليلى الحربي', open: 18, won: 9, due: 3 },
  { user_id: 4, name: 'خالد الشمري', open: 11, won: 7, due: 0 },
]
