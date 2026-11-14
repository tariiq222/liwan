import { describe, expect, it } from 'vitest'
import { SETUP_STEP_KEYS, SetupProgressChangeSchema, SetupProgressSchema } from '../setupProgress'

const open = (key: string) => ({ key, outcome: null, recorded_by: null, recorded_at: null })
const FRESH = { steps: SETUP_STEP_KEYS.map(open), closed_at: null, complete: false }

describe('SetupProgressSchema', () => {
  it('reads the five steps in the server order, all open', () => {
    expect(SetupProgressSchema.parse(FRESH).steps.map(step => step.key)).toEqual(['company', 'sector', 'channels', 'team', 'contacts'])
  })

  it('reads a recorded step and a closed wizard', () => {
    const steps = FRESH.steps.map(step => (step.key === 'team'
      ? { key: 'team', outcome: 'skipped', recorded_by: { id: 7, name: 'Salma' }, recorded_at: '2026-11-13T09:00:00' }
      : step))
    expect(SetupProgressSchema.safeParse({ steps, closed_at: '2026-11-13T10:00:00', complete: false }).success).toBe(true)
  })

  it('refuses an unknown step, an unknown outcome, a missing step and extra fields', () => {
    expect(SetupProgressSchema.safeParse({ ...FRESH, steps: [...FRESH.steps.slice(1), open('billing')] }).success).toBe(false)
    expect(SetupProgressSchema.safeParse({ ...FRESH, steps: [{ ...open('company'), outcome: 'later' }, ...FRESH.steps.slice(1)] }).success).toBe(false)
    expect(SetupProgressSchema.safeParse({ ...FRESH, steps: FRESH.steps.slice(1) }).success).toBe(false)
    expect(SetupProgressSchema.safeParse({ ...FRESH, extra: 1 }).success).toBe(false)
  })
})

describe('SetupProgressChangeSchema', () => {
  it.each([
    [{ step: 'company', outcome: 'done' }],
    [{ step: 'sector', outcome: null }],
    [{ closed: true }],
    [{ closed: false }],
  ])('accepts %j', (body) => {
    expect(SetupProgressChangeSchema.safeParse(body).success).toBe(true)
  })

  it.each([
    [{ step: 'company' }],
    [{ step: 'nope', outcome: 'done' }],
    [{ closed: 'yes' }],
    [{ step: 'company', outcome: 'done', closed: true }],
    [{}],
  ])('refuses %j', (body) => {
    expect(SetupProgressChangeSchema.safeParse(body).success).toBe(false)
  })
})
