import { describe, expect, it } from 'vitest'
import { MeSchema, TaskDetailSchema, TaskSchema } from '@nasq/contracts'
import { makeTask, me, taskDetail } from '../pmo'

describe('Storybook PMO fixtures follow the wire contracts', () => {
  it('builds tasks and task details that parse', () => {
    expect(() => TaskSchema.parse(makeTask({ state: 'done', is_closed: true }))).not.toThrow()
    expect(TaskDetailSchema.parse(taskDetail({ priority: '3' })).priority).toBe('3')
  })

  it('signs in a user who can read projects', () => {
    expect(MeSchema.parse(me).capabilities).toContain('pmo.projects.read')
  })
})
