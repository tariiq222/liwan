import { describe, expect, it } from 'vitest'
import { ProjectDetailSchema, ProjectPatchSchema, ProjectSchema } from '../project'
import { ProjectToolPoliciesSchema, ProjectToolsStateSchema } from '../project-tools'
import { ProjectSettingsPatchSchema } from '../settings'

const summary = { id: 1, name: 'Simple', status: null, progress: 0, task_count: 0, closed_task_count: 0, active: true, can_manage: true, charter_state: null, phase: null }

describe('project tools contracts', () => {
  it('accepts all company tool policies and rejects unknown values', () => {
    expect(ProjectSettingsPatchSchema.parse({ planning_tool_policy: 'optional', governance_tool_policy: 'enabled', finance_tool_policy: 'disabled' })).toEqual({
      planning_tool_policy: 'optional', governance_tool_policy: 'enabled', finance_tool_policy: 'disabled',
    })
    expect(ProjectSettingsPatchSchema.safeParse({ planning_tool_policy: 'default_on' }).success).toBe(false)
  })

  it('accepts only boolean preferences with a concurrency token', () => {
    expect(ProjectPatchSchema.parse({ tool_preferences: { planning: true, finance: false }, expected_updated_at: 'v2' }).tool_preferences).toEqual({ planning: true, finance: false })
    for (const tool_preferences of [{ planning: 'true' }, { meetings: true }, { governance: null }]) {
      expect(ProjectPatchSchema.safeParse({ tool_preferences, expected_updated_at: 'v2' }).success).toBe(false)
    }
    expect(ProjectPatchSchema.safeParse({ tool_preferences: {} }).success).toBe(false)
    expect(ProjectPatchSchema.safeParse({ tools: {}, expected_updated_at: 'v2' }).success).toBe(false)
    expect(ProjectPatchSchema.safeParse({ planning_tool_policy: 'enabled', expected_updated_at: 'v2' }).success).toBe(false)
  })

  it('represents inactive governance without fabricating a charter state or phase', () => {
    expect(ProjectSchema.parse(summary).charter_state).toBeNull()
    expect(ProjectSchema.parse(summary).phase).toBeNull()
    expect(ProjectSchema.safeParse({ ...summary, charter_state: undefined }).success).toBe(false)
  })
})


describe('server-owned project tool read state', () => {
  const tools = {
    planning: { policy: 'enabled', enabled: true, can_toggle: false },
    governance: { policy: 'optional', enabled: false, can_toggle: true },
    finance: { policy: 'disabled', enabled: false, can_toggle: false },
  }

  it('requires all tools and rejects extra capabilities or invalid state types', () => {
    expect(ProjectToolsStateSchema.parse(tools)).toEqual(tools)
    expect(ProjectToolPoliciesSchema.parse({ planning: 'enabled', governance: 'optional', finance: 'disabled' }).planning).toBe('enabled')
    for (const invalid of [
      { ...tools, finance: undefined },
      { ...tools, meetings: tools.planning },
      { ...tools, planning: { ...tools.planning, enabled: 'true' } },
      { ...tools, planning: { ...tools.planning, preference: true } },
    ]) expect(ProjectToolsStateSchema.safeParse(invalid).success).toBe(false)
    // Policy does not fabricate an entitlement: effective state comes from the server.
    expect(ProjectToolsStateSchema.parse({ ...tools, planning: { policy: 'enabled', enabled: false, can_toggle: false } }).planning.enabled).toBe(false)
  })

  it('reads core outcomes and explicit redactions on a project without governance', () => {
    const detail = {
      ...summary, stages: [], description_html: '', manager: null, privacy_visibility: 'employees',
      date_start: null, date_end: null, tags: [], followers_count: 0, milestone_count: null,
      completion_approval: 'none', completion_approver: null, updated_at: 'v1',
      tools, objectives: [{ id: 5, goal: 'Deliver', metric: '', target: '' }], success_criteria: '20 requests',
      charter: null, phase_state: null, change_control_mode: 'optional',
    }
    const parsed = ProjectDetailSchema.parse(detail)
    expect(parsed.objectives[0]?.id).toBe(5)
    expect(parsed.charter).toBeNull()
    expect(parsed.phase_state).toBeNull()
    expect(parsed.milestone_count).toBeNull()
    expect(ProjectDetailSchema.safeParse({ ...detail, objectives: [{ goal: 'Deliver', metric: '', target: '' }] }).success).toBe(false)
    expect(ProjectDetailSchema.safeParse({ ...detail, tools: undefined }).success).toBe(false)
    expect(ProjectDetailSchema.safeParse({ ...detail, success_criteria: undefined }).success).toBe(false)
  })
})
