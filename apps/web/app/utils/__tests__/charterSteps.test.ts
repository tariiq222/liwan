import { describe, expect, it } from 'vitest'
import {
  CHARTER_STEP_FIELDS,
  CHARTER_WIZARD_STEPS,
  adjacentCharterStep,
  charterStepsForType,
  clampCharterStep,
  fieldsForStep,
  fieldsOutsideSteps,
  parseCharterStepQuery,
  stepForField,
} from '../charterSteps'
import { CHARTER_FIELD_KEYS } from '../projectCharter'

describe('charter wizard steps', () => {
  it('frames the optional steps with basics first and review last', () => {
    expect(CHARTER_WIZARD_STEPS).toEqual(['basics', 'justification', 'scope', 'schedule', 'budget', 'risks', 'review'])
    expect(charterStepsForType(null)).toEqual([...CHARTER_WIZARD_STEPS])
    expect(charterStepsForType(undefined)).toEqual([...CHARTER_WIZARD_STEPS])
    expect(charterStepsForType([])).toEqual(['basics', 'review'])
  })

  it('keeps the canonical order whatever order the type lists its steps in', () => {
    expect(charterStepsForType(['budget', 'justification'])).toEqual(['basics', 'justification', 'budget', 'review'])
    expect(charterStepsForType(['signatures', 'scope'])).toEqual(['basics', 'scope', 'review'])
  })

  it('assigns every commercial charter field to exactly one step', () => {
    const assigned = Object.values(CHARTER_STEP_FIELDS).flat()
    expect(new Set(assigned).size).toBe(assigned.length)
    expect([...assigned].sort()).toEqual([...CHARTER_FIELD_KEYS].sort())
    expect(fieldsForStep('review')).toEqual([])
    expect(fieldsForStep('basics')).toContain('type')
  })

  it('reports the fields a shortened walk never shows', () => {
    const steps = charterStepsForType(['justification'])
    const hidden = fieldsOutsideSteps(steps)
    expect(hidden).toContain('scope')
    expect(hidden).toContain('budget_state')
    expect(hidden).not.toContain('name')
    expect(hidden).not.toContain('rationale')
    expect(fieldsOutsideSteps(charterStepsForType(null))).toEqual([])
  })

  it('finds the step that owns a field within the current walk', () => {
    const full = charterStepsForType(null)
    expect(stepForField(full, 'amount')).toBe('budget')
    expect(stepForField(full, 'manager')).toBe('basics')
    expect(stepForField(charterStepsForType(['scope']), 'amount')).toBeNull()
  })

  it('reads the step from the query and falls back to the first step', () => {
    const steps = charterStepsForType(['scope', 'budget'])
    expect(parseCharterStepQuery('scope', steps)).toBe('scope')
    expect(parseCharterStepQuery(['budget'], steps)).toBe('budget')
    expect(parseCharterStepQuery('justification', steps)).toBe('basics')
    expect(parseCharterStepQuery(undefined, steps)).toBe('basics')
    expect(parseCharterStepQuery('nope', steps)).toBe('basics')
  })

  it('clamps to the nearest earlier step when the classification drops the current one', () => {
    expect(clampCharterStep('budget', charterStepsForType(['justification', 'scope']))).toBe('scope')
    expect(clampCharterStep('justification', charterStepsForType([]))).toBe('basics')
    expect(clampCharterStep('review', charterStepsForType(['scope']))).toBe('review')
  })

  it('moves one step at a time and stops at the ends', () => {
    const steps = charterStepsForType(['scope'])
    expect(adjacentCharterStep('basics', steps, 1)).toBe('scope')
    expect(adjacentCharterStep('scope', steps, -1)).toBe('basics')
    expect(adjacentCharterStep('review', steps, 1)).toBeNull()
    expect(adjacentCharterStep('basics', steps, -1)).toBeNull()
    expect(adjacentCharterStep('budget', steps, 1)).toBeNull()
  })
})
