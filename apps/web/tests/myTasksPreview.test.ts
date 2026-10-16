import { describe, expect, it } from 'vitest'
import { PersonalTaskSchema, MyTaskListPageSchema, TaskDetailSchema, TimelineEntrySchema } from '@webvue/contracts'
import { createMyTasksPreview } from '../e2e/my-tasks-preview-state.mjs'

describe('stateful synthetic My tasks preview contract', () => {
  it('creates, updates and closes a record without losing the DTO or list scope', () => {
    const api = createMyTasksPreview()
    const created = api('POST', '/api/v1/my-tasks', { name: 'اختبار رحلة', assignees: [5] })!
    const task = PersonalTaskSchema.parse(created.body)
    expect(created.status).toBe(201)
    expect(task.assignees[0]?.name).toBe('سارة محمد')
    expect(PersonalTaskSchema.parse(api('PATCH', `/api/v1/my-tasks/${task.id}`, { description: 'وصف', date_deadline: null })!.body).description).toBe('وصف')
    api('POST', `/api/v1/my-tasks/${task.id}/cancel`)
    const list = MyTaskListPageSchema.parse(api('GET', '/api/v1/my-tasks?closed=1&q=اختبار')!.body)
    expect(list.items.map(value => value.state)).toEqual(['cancelled'])
  })
  it('supports child records, comment data and file upload/download/deletion', () => {
    const api = createMyTasksPreview()
    const child = PersonalTaskSchema.parse(api('POST', '/api/v1/my-tasks', { name: 'فرعية', parent_id: 7 })!.body)
    expect(child.parent?.id).toBe(7)
    expect(PersonalTaskSchema.parse(api('GET', '/api/v1/my-tasks/7')!.body).subtasks.some(value => value.id === child.id)).toBe(true)
    expect(api('POST', '/api/v1/my-tasks/7/comments', { body: 'تعليق' })!.body.body).toBe('تعليق')
    const file = api('POST', '/api/v1/my-tasks/7/attachments', { name: 'test.txt', mimetype: 'text/plain', data: 'aGVsbG8=' })!.body
    expect(api('GET', file.url)!.bytes.toString()).toBe('hello')
    api('DELETE', `/api/v1/my-tasks/7/attachments/${file.id}`)
    expect(api('GET', '/api/v1/my-tasks/7/attachments')!.body.total).toBe(0)
  })
  it('converts into a readable project DTO and withdraws the personal endpoint', () => {
    const api = createMyTasksPreview()
    const child = PersonalTaskSchema.parse(api('POST', '/api/v1/my-tasks', { name: 'فرعية منقولة', parent_id: 8 })!.body)
    api('POST', '/api/v1/my-tasks/8/comments', { body: 'تعليق محفوظ' })
    expect(api('POST', '/api/v1/my-tasks/8/convert', { project_id: 1 })!.body.href).toBe('/projects/1/tasks/8')
    expect(api('GET', '/api/v1/my-tasks/8')!.status).toBe(404)
    const task = TaskDetailSchema.parse(api('GET', '/api/v1/tasks/8')!.body)
    expect(task.name).toBe('اشترِ الورق')
    expect(task.project?.id).toBe(1)
    expect(task.subtasks.map(value => value.id)).toEqual([child.id])
    expect(TimelineEntrySchema.array().parse(api('GET', '/api/v1/tasks/8/timeline')!.body)[0]?.body_html).toContain('تعليق محفوظ')
    expect(MyTaskListPageSchema.parse(api('GET', '/api/v1/my-tasks')!.body).items.find(value => value.id === 8)?.source).toBe('project')
  })
})
