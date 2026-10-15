import type { ProjectPhaseState } from '@nasq/contracts'
import { describe, expect, it } from 'vitest'
import { canMoveForward, gateCheckRows, phaseErrorKey, phaseNumber, phaseSteps, UNKNOWN_CHECK_KEY } from '../projectPhase'

describe('phaseSteps', () => {
  it('marks earlier steps done, the current one, and later steps upcoming', () => {
    expect(phaseSteps('executing').map(step => step.state)).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming'])
  })
  it('keeps the lifecycle order and numbers from one', () => {
    expect(phaseSteps('initiating').map(step => step.phase)).toEqual(['initiating', 'planning', 'executing', 'closing', 'closed'])
    expect(phaseNumber('initiating')).toBe(1)
    expect(phaseNumber('closed')).toBe(5)
  })
})

describe('gateCheckRows', () => {
  it('links the charter check to the charter page', () => {
    expect(gateCheckRows(7, [{ key: 'charter_approved', ok: false }])).toEqual([
      { key: 'charter_approved', ok: false, labelKey: 'projects.phase.checks.charter_approved', fixTo: '/projects/7/charter' },
    ])
  })
  it('maps an unknown key to the generic label without a link', () => {
    expect(gateCheckRows(7, [{ key: 'something_new', ok: false }])[0]).toMatchObject({ labelKey: UNKNOWN_CHECK_KEY, fixTo: null })
  })
})

describe('canMoveForward', () => {
  const state = (ok: boolean, next: 'planning' | null = 'planning'): ProjectPhaseState =>
    ({ current: 'initiating', next, previous: null, next_checks: [{ key: 'charter_approved', ok }] })
  it('needs a manager, a next phase and every check met', () => {
    expect(canMoveForward(state(true), true)).toBe(true)
    expect(canMoveForward(state(false), true)).toBe(false)
    expect(canMoveForward(state(true), false)).toBe(false)
    expect(canMoveForward(state(true, null), true)).toBe(false)
  })
})

describe('phaseErrorKey', () => {
  it('maps codes to locale keys and never to server text', () => {
    expect(phaseErrorKey(409, 'phase_gate')).toBe('projects.phase.errors.gate')
    expect(phaseErrorKey(409, 'phase_step')).toBe('projects.phase.errors.step')
    expect(phaseErrorKey(403, 'forbidden')).toBe('projects.phase.errors.forbidden')
    expect(phaseErrorKey(500, undefined)).toBe('errors.generic')
  })
})
