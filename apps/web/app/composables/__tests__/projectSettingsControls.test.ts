import { describe, expect, it } from 'vitest'
import { ProjectCreateDefaultsSchema, ProjectCreateSchema, ProjectSettingsSchema } from '@webvue/contracts'
import { projectSettingsKeys } from '../useProjectSettings'

describe('project settings controls client contracts', () => {
  it('treats create defaults as a creator-gated subset', () => {
    const defaults = ProjectCreateDefaultsSchema.parse({
      require_manager_on_create: true,
      require_end_date_on_create: true,
      default_manager_id: 7,
    })
    expect(defaults.default_manager_id).toBe(7)
    expect(() => ProjectCreateDefaultsSchema.parse({
      require_manager_on_create: true,
      require_end_date_on_create: true,
      default_manager_id: 7,
      default_stages: [],
    })).toThrow()
  })

  it('keeps create payload strict and settings defaults true', () => {
    expect(ProjectCreateSchema.parse({ name: 'P', date_end: '2030-01-01' }).name).toBe('P')
    expect(projectSettingsKeys.createDefaults).toEqual(['project-settings', 'create-defaults'])
    expect(ProjectSettingsSchema.parse({
      project_creators: 'managers',
      default_stages: [{ name: 'A', fold: false }],
      require_manager_on_create: true,
      require_end_date_on_create: true,
      default_completion_approval: 'none',
      deadline_reminders_enabled: true,
      deadline_reminders_days_before: 1,
      overdue_digest_enabled: true,
      require_charter_approval: false,
      close_with_open_tasks: 'block',
      register_status_transitions: 'sequence',
      extensions: [],
    }).require_manager_on_create).toBe(true)
  })
})
