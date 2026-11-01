import { describe, expect, it } from 'vitest'
import { HR_WARNING_STATES, type HrWarning } from '@liwan/contracts'
import {
  canIssueHrWarning,
  canWithdrawHrWarning,
  hrWarningBadge,
  hrWarningEvents,
  ownHrWarningActions,
  sortHrWarningTypes,
} from '../hrWarnings'

const base = {
  employee: { id: 7, name: 'Noura' }, issued_by: null, issued_at: null, acknowledged_at: null, contested_at: null,
  withdrawn_by: null, withdrawn_at: null,
} as unknown as HrWarning

describe('hrWarningBadge', () => {
  it('gives every state a tone and a translated label key', () => {
    for (const state of HR_WARNING_STATES) expect(hrWarningBadge(state).labelKey).toBe(`hrWarnings.state.${state}`)
    expect(hrWarningBadge('acknowledged').tone).toBe('success')
    expect(hrWarningBadge('contested').tone).toBe('warning')
    expect(hrWarningBadge('withdrawn').tone).toBe('neutral')
  })
})

describe('who can act', () => {
  it('lets an issuer issue only a draft', () => {
    expect(canIssueHrWarning({ state: 'draft' }, true)).toBe(true)
    expect(canIssueHrWarning({ state: 'issued' }, true)).toBe(false)
    expect(canIssueHrWarning({ state: 'draft' }, false)).toBe(false)
  })

  it('lets HR withdraw an open warning and an issuer discard a draft', () => {
    const hr = { canManage: true, canIssue: true }
    const manager = { canManage: false, canIssue: true }
    for (const state of ['issued', 'acknowledged', 'contested'] as const) {
      expect(canWithdrawHrWarning({ state }, hr)).toBe(true)
      expect(canWithdrawHrWarning({ state }, manager)).toBe(false)
    }
    expect(canWithdrawHrWarning({ state: 'draft' }, hr)).toBe(true)
    expect(canWithdrawHrWarning({ state: 'draft' }, manager)).toBe(true)
    expect(canWithdrawHrWarning({ state: 'draft' }, { canManage: false, canIssue: false })).toBe(false)
    expect(canWithdrawHrWarning({ state: 'withdrawn' }, hr)).toBe(false)
  })

  it('lets the employee answer an issued warning unless answers are off', () => {
    expect(ownHrWarningActions({ state: 'issued', acknowledgement: 'required' })).toEqual({ acknowledge: true, contest: true })
    expect(ownHrWarningActions({ state: 'issued', acknowledgement: 'optional' })).toEqual({ acknowledge: true, contest: true })
    expect(ownHrWarningActions({ state: 'issued', acknowledgement: 'off' })).toEqual({ acknowledge: false, contest: false })
    expect(ownHrWarningActions({ state: 'acknowledged', acknowledgement: 'required' })).toEqual({ acknowledge: false, contest: false })
  })
})

describe('hrWarningEvents', () => {
  it('lists the dated steps oldest first with who did them', () => {
    const events = hrWarningEvents({
      ...base,
      issued_by: { id: 1, name: 'Hala' }, issued_at: '2026-10-01T08:00:00Z',
      contested_at: '2026-10-02T09:00:00Z',
      withdrawn_by: { id: 1, name: 'Hala' }, withdrawn_at: '2026-10-03T10:00:00Z',
    })
    expect(events).toEqual([
      { kind: 'issued', at: '2026-10-01T08:00:00Z', by: 'Hala' },
      { kind: 'contested', at: '2026-10-02T09:00:00Z', by: 'Noura' },
      { kind: 'withdrawn', at: '2026-10-03T10:00:00Z', by: 'Hala' },
    ])
  })

  it('is empty for a draft', () => {
    expect(hrWarningEvents(base)).toEqual([])
  })
})

describe('sortHrWarningTypes', () => {
  it('orders by severity, then name, without changing the input', () => {
    const types = [{ name: 'Final', severity: 3 }, { name: 'Verbal', severity: 1 }, { name: 'Written', severity: 2 }, { name: 'Another', severity: 2 }]
    expect(sortHrWarningTypes(types).map(type => type.name)).toEqual(['Verbal', 'Another', 'Written', 'Final'])
    expect(types[0]!.name).toBe('Final')
  })
})
