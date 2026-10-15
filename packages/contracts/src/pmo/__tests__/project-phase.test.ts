import { describe, expect, it } from 'vitest'
import { PROJECT_PHASES, ProjectPhaseMoveSchema, ProjectPhaseStateSchema } from '../project'

const state = { current: 'planning', next: 'executing', previous: 'initiating', next_checks: [{ key: 'charter_approved', ok: true }], can_move: true }

describe('project phase contract', () => {
  it('lists the lifecycle in order', () => {
    expect(PROJECT_PHASES).toEqual(['initiating', 'planning', 'executing', 'closing', 'closed'])
  })

  it('accepts the phase card and null ends', () => {
    expect(ProjectPhaseStateSchema.parse(state).next).toBe('executing')
    expect(ProjectPhaseStateSchema.parse({ ...state, current: 'closed', next: null, next_checks: [] }).next).toBeNull()
  })

  it('rejects unknown keys and unknown phases', () => {
    expect(() => ProjectPhaseStateSchema.parse({ ...state, extra: 1 })).toThrow()
    expect(() => ProjectPhaseStateSchema.parse({ ...state, current: 'monitoring' })).toThrow()
  })

  it('requires a write token on the move body', () => {
    expect(ProjectPhaseMoveSchema.safeParse({ phase: 'planning', expected_updated_at: 'v3' }).success).toBe(true)
    expect(ProjectPhaseMoveSchema.safeParse({ phase: 'planning' }).success).toBe(false)
  })
})
