import { describe, expect, it } from 'vitest'
import {
  ProjectTemplateApplySchema,
  ProjectTemplateCreateSchema,
  ProjectTemplatePatchSchema,
  ProjectTemplateDefinitionSchema,
  ProjectTemplateSchema,
} from '../project-template'

const definition = {
  stages: [{ key: 'plan', name: 'Plan', fold: false }],
  milestones: [{ key: 'launch', name: 'Launch', offset_days: 4 }],
  tasks: [{
    key: 'brief', name: 'Brief', stage_key: 'plan', start_offset: 0,
    duration_days: 2, milestone_key: 'launch', dependency_keys: [],
  }],
}

describe('project template contracts', () => {
  it('accepts the structured authoring definition and strict record shape', () => {
    expect(ProjectTemplateDefinitionSchema.parse(definition).tasks[0].stage_key).toBe('plan')
    expect(() => ProjectTemplateDefinitionSchema.parse({ ...definition, extra: true })).toThrow()
    expect(() => ProjectTemplateSchema.parse({
      id: 1, name: 'Launch', description: '', definition,
      can_manage: true, can_apply: true, extra: 'no',
    })).toThrow()
  })

  it('bounds date input to calendar ISO days', () => {
    expect(ProjectTemplateApplySchema.parse({ name: 'New', start_date: '2030-02-01' }).start_date).toBe('2030-02-01')
    expect(() => ProjectTemplateApplySchema.parse({ name: 'New', start_date: '2030-2-1' })).toThrow()
    expect(() => ProjectTemplateApplySchema.parse({ name: 'New', start_date: '2030-02-31' })).toThrow()
    expect(() => ProjectTemplateDefinitionSchema.parse({
      ...definition,
      tasks: [{ ...definition.tasks[0], duration_days: 3651 }],
    })).toThrow()
  })

  it('rejects graph references and cycles', () => {
    expect(() => ProjectTemplateDefinitionSchema.parse({
      ...definition,
      tasks: [{ ...definition.tasks[0], dependency_keys: ['missing'] }],
    })).toThrow()
    expect(() => ProjectTemplateDefinitionSchema.parse({
      ...definition,
      tasks: [{ ...definition.tasks[0], dependency_keys: ['brief'] }],
    })).toThrow()
  })
})


describe('template authoring validation parity', () => {
  it('rejects duplicate predecessor entries for create and patch', () => {
    const invalid = { ...definition, tasks: [
      definition.tasks[0],
      { ...definition.tasks[0], key: 'build', dependency_keys: ['brief', 'brief'] },
    ] }
    expect(ProjectTemplateCreateSchema.safeParse({ name: 'Template', definition: invalid }).success).toBe(false)
    expect(ProjectTemplatePatchSchema.safeParse({ definition: invalid }).success).toBe(false)
  })
  it('rejects whitespace names and trims accepted names', () => {
    for (const collection of ['stages', 'milestones', 'tasks'] as const) {
      const invalid = { ...definition, [collection]: [{ ...definition[collection][0], name: '  ' }] }
      expect(ProjectTemplateDefinitionSchema.safeParse(invalid).success).toBe(false)
    }
    expect(ProjectTemplateCreateSchema.safeParse({ name: '  ', definition }).success).toBe(false)
    expect(ProjectTemplatePatchSchema.safeParse({ name: '  ' }).success).toBe(false)
    expect(ProjectTemplateApplySchema.safeParse({ name: '  ', start_date: '2030-01-01' }).success).toBe(false)
    expect(ProjectTemplateCreateSchema.parse({ name: ' Name ', definition }).name).toBe('Name')
  })
  it('rejects an empty patch and year zero', () => {
    expect(ProjectTemplatePatchSchema.safeParse({}).success).toBe(false)
    expect(ProjectTemplateApplySchema.safeParse({ name: 'Name', start_date: '0000-01-01' }).success).toBe(false)
  })
})
