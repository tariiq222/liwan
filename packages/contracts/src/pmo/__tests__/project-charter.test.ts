import {
  BudgetStateSchema,
  PROJECT_CHARTER_STEPS,
  ProjectCharterDefaultsSchema,
  ProjectCharterSchema,
  ProjectCharterStateSchema,
  ProjectCharterWriteSchema,
  ProjectPrioritySchema,
} from '../project-charter'

const CHARTER = {
  code: 'PRJ-000001',
  type: { id: 4, name: 'تقني', charter_steps: ['justification', 'scope', 'schedule', 'budget', 'risks'] },
  owning_unit: { id: 8, name: 'PMO' },
  sponsor: { id: 2, name: 'Sara' },
  authority: 'Board',
  rationale: 'Need',
  objectives: [{ goal: 'Ship', metric: '', target: '' }],
  benefits: 'Faster',
  scope: 'In',
  exclusions: 'Out',
  high_level_requirements: 'Req',
  deliverables: [{ name: 'Doc', description: '', acceptance: 'Signed' }],
  success: 'Done',
  budget_state: 'estimate',
  amount: 0,
  currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 },
  priority: 'high',
  assumptions: 'A',
  constraints: 'C',
  closure: 'Close',
  state: 'final',
}

describe('ProjectCharterSchema', () => {
  it('accepts the frozen read shape including zero estimate and empty nested strings', () => {
    expect(ProjectCharterSchema.parse(CHARTER).amount).toBe(0)
    expect(ProjectCharterSchema.parse({
      ...CHARTER,
      code: null,
      type: null,
      owning_unit: null,
      sponsor: null,
      objectives: [],
      deliverables: [],
      budget_state: 'unknown',
      amount: null,
      currency: null,
      priority: null,
    }).budget_state).toBe('unknown')
  })
  it('rejects extra keys and inverted budget vocabulary', () => {
    expect(() => ProjectCharterSchema.parse({ ...CHARTER, extra: 1 })).toThrow()
    expect(() => BudgetStateSchema.parse('approved')).toThrow()
    expect(() => ProjectPrioritySchema.parse('urgent')).toThrow()
  })
  it('carries the charter state and the type steps that drive the wizard', () => {
    expect(ProjectCharterSchema.parse({ ...CHARTER, state: 'draft' }).state).toBe('draft')
    expect(() => ProjectCharterSchema.parse({ ...CHARTER, state: 'approved' })).toThrow()
    expect(() => ProjectCharterSchema.parse({ ...CHARTER, type: { id: 4, name: 'تقني' } })).toThrow()
    expect(() => ProjectCharterSchema.parse({ ...CHARTER, type: { ...CHARTER.type, charter_steps: ['signatures'] } })).toThrow()
    expect(ProjectCharterSchema.parse({ ...CHARTER, type: { ...CHARTER.type, charter_steps: [] } }).type?.charter_steps).toEqual([])
    expect(PROJECT_CHARTER_STEPS).toEqual(['justification', 'scope', 'schedule', 'budget', 'risks'])
    expect(ProjectCharterStateSchema.options).toEqual(['draft', 'final'])
  })
})

describe('ProjectCharterWriteSchema', () => {
  it('is strict partial and rejects readonly code/currency/refs', () => {
    expect(ProjectCharterWriteSchema.parse({})).toEqual({})
    expect(ProjectCharterWriteSchema.parse({ type_id: 4, sponsor_id: null, amount: 0 }).type_id).toBe(4)
    expect(() => ProjectCharterWriteSchema.parse({ code: 'PRJ-000001' })).toThrow()
    expect(() => ProjectCharterWriteSchema.parse({ currency: CHARTER.currency })).toThrow()
    expect(() => ProjectCharterWriteSchema.parse({ type: CHARTER.type })).toThrow()
    expect(ProjectCharterWriteSchema.parse({ state: 'draft' }).state).toBe('draft')
    expect(() => ProjectCharterWriteSchema.parse({ state: 'archived' })).toThrow()
  })
})

describe('ProjectCharterDefaultsSchema', () => {
  it('returns currency or null', () => {
    expect(ProjectCharterDefaultsSchema.parse({ currency: CHARTER.currency }).currency?.symbol).toBe('ر.س')
    expect(ProjectCharterDefaultsSchema.parse({ currency: null }).currency).toBeNull()
  })
})
