import type { ProjectPhaseState } from '@webvue/contracts'
import { describe, expect, it } from 'vitest'
import { canMoveForward, gateCheckRows, isGateAction, isGateCardVisible, phaseFailure, phaseNumber, phaseSteps, UNKNOWN_CHECK_KEY } from '../projectPhase'

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

describe('isGateCardVisible', () => {
  const noChecks: ProjectPhaseState = { current: 'planning', next: 'executing', previous: 'initiating', next_checks: [] }
  it('hides a check-less gate from a reader only', () => {
    expect(isGateCardVisible(noChecks, false)).toBe(false)
    expect(isGateCardVisible(noChecks, true)).toBe(true)
    expect(isGateCardVisible({ ...noChecks, next_checks: [{ key: 'charter_approved', ok: false }] }, false)).toBe(true)
    expect(isGateCardVisible({ current: 'closed', next: null, previous: 'closing', next_checks: [] }, false)).toBe(true)
  })
})

describe('phaseFailure', () => {
  const failure = (status: number, code: string) => phaseFailure(Object.assign(new Error('server text'), { status, code }))
  it('warns on a stale write', () => {
    expect(failure(409, 'stale_write')).toEqual({ key: 'projects.phase.stale', color: 'warning' })
  })
  it('maps gate, step and permission failures to locale keys', () => {
    expect(failure(409, 'phase_gate')).toEqual({ key: 'projects.phase.errors.gate', color: 'error' })
    expect(failure(409, 'phase_step')).toEqual({ key: 'projects.phase.errors.step', color: 'error' })
    expect(failure(403, 'forbidden')).toEqual({ key: 'projects.phase.errors.forbidden', color: 'error' })
  })
  it('falls back to the generic message for anything else, never server text', () => {
    expect(failure(500, 'boom')).toEqual({ key: 'errors.generic', color: 'error' })
    expect(phaseFailure(new Error('offline'))).toEqual({ key: 'errors.generic', color: 'error' })
    expect(phaseFailure(undefined)).toEqual({ key: 'errors.generic', color: 'error' })
  })
})

describe('an archived project has no phase gate', () => {
  const planning: ProjectPhaseState = { current: 'planning', next: 'executing', previous: 'initiating', next_checks: [{ key: 'charter_approved', ok: false }] }
  it('hides the card and its call to action even from a manager', () => {
    expect(isGateCardVisible(planning, true, false)).toBe(false)
    expect(isGateAction(planning, true, false)).toBe(false)
    expect(isGateCardVisible({ current: 'closed', next: null, previous: 'closing', next_checks: [] }, true, false)).toBe(false)
  })
  it('keeps the card for an active project', () => {
    expect(isGateCardVisible(planning, true, true)).toBe(true)
    expect(isGateAction(planning, false)).toBe(true)
  })
})
