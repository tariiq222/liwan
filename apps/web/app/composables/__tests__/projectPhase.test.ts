import type { ProjectPhaseState } from '@liwan/contracts'
import { describe, expect, it } from 'vitest'
import { canMoveForward, gateCheckRows, isGateAction, isGateCardVisible, isWarningGate, unmetWarnings, phaseFailure, phaseNumber, phaseSteps, UNKNOWN_CHECK_KEY } from '../projectPhase'

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
  it('links the baseline check to the baselines page, where it only warns when the company says so', () => {
    expect(gateCheckRows(7, [{ key: 'baseline_set', ok: false, warning: true }])).toEqual([
      { key: 'baseline_set', ok: false, labelKey: 'projects.phase.checks.baseline_set', fixTo: '/projects/7/baselines' },
    ])
    const planning: ProjectPhaseState = { current: 'planning', next: 'executing', previous: 'initiating', next_checks: [{ key: 'baseline_set', ok: false, warning: true }] }
    expect(canMoveForward(planning, true)).toBe(true)
    expect(unmetWarnings(planning.next_checks)).toHaveLength(1)
    expect(canMoveForward({ ...planning, next_checks: [{ key: 'baseline_set', ok: false }] }, true)).toBe(false)
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

describe('warning gate checks', () => {
  const closing: ProjectPhaseState = { current: 'closing', next: 'closed', previous: 'executing', next_checks: [{ key: 'no_open_tasks', ok: false, warning: true }] }
  it('lets a manager move on an unmet warning, but not on an unmet blocking check', () => {
    expect(canMoveForward(closing, true)).toBe(true)
    expect(canMoveForward({ ...closing, next_checks: [{ key: 'no_open_tasks', ok: false }] }, true)).toBe(false)
    expect(unmetWarnings(closing.next_checks)).toEqual([{ key: 'no_open_tasks', ok: false, warning: true }])
  })
  it('recognises a refused move that only needs confirmation', () => {
    const refusal = (checks: unknown[]) => ({ status: 409, code: 'phase_gate', details: { checks } })
    expect(isWarningGate(refusal([{ key: 'no_open_tasks', ok: false, warning: true }]))).toBe(true)
    expect(isWarningGate(refusal([{ key: 'charter_approved', ok: false }, { key: 'no_open_tasks', ok: false, warning: true }]))).toBe(false)
    expect(isWarningGate(refusal([{ key: 'no_open_tasks', ok: true, warning: true }]))).toBe(false)
    expect(isWarningGate({ status: 409, code: 'stale_write' })).toBe(false)
    expect(isWarningGate(null)).toBe(false)
  })
  it('links the open-tasks check to the project tasks', () => {
    expect(gateCheckRows(7, closing.next_checks)[0]).toMatchObject({ labelKey: 'projects.phase.checks.no_open_tasks', fixTo: '/projects/7/tasks' })
  })
})
