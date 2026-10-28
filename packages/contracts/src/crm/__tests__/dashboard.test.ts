import { CrmDashboardSchema } from '../index'

const agent = { due_now: 2, new_today: 1, won_this_month: { count: 1, value: 300 } }
const manager = {
  unassigned: 1,
  needs_manager: 0,
  due_follow_ups: 3,
  won_this_month: { count: 2, value: 500.5 },
  conversion_by_source: [{ source_id: 4, name: 'Web', total: 5, won: 1 }],
  agents: [{ user_id: 7, name: 'Agent', open: 2, won: 1, due: 1 }],
}

describe('CrmDashboardSchema', () => {
  it('accepts an agent-only and a manager dashboard', () => {
    expect(CrmDashboardSchema.parse({ agent, manager: null }).manager).toBeNull()
    expect(CrmDashboardSchema.parse({ agent, manager }).manager?.agents).toHaveLength(1)
  })

  it('allows a source-less conversion row', () => {
    const row = { source_id: null, name: '', total: 1, won: 0 }
    expect(CrmDashboardSchema.parse({ agent, manager: { ...manager, conversion_by_source: [row] } })).toBeTruthy()
  })

  it('rejects an unknown key, a negative count and a missing manager key', () => {
    expect(() => CrmDashboardSchema.parse({ agent: { ...agent, extra: 1 }, manager: null })).toThrow()
    expect(() => CrmDashboardSchema.parse({ agent: { ...agent, due_now: -1 }, manager: null })).toThrow()
    expect(() => CrmDashboardSchema.parse({ agent })).toThrow()
  })
})
