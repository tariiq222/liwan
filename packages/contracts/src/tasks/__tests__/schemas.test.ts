import golden from './personal-task.golden.json'
import {
  ConvertResultSchema,
  ConvertTargetSchema,
  MyTaskListItemSchema,
  MyTaskListPageSchema,
  PersonalTaskAttachmentSchema,
  PersonalTaskCommentSchema,
  PersonalTaskSchema,
  PersonalTaskStateSchema,
} from '../index'

const PERSON = { id: 2, name: 'x', user_id: 2 }
const ACTIONS = { write: true, done: true, reopen: false, cancel: true, convert: false }
const DETAIL = {
  id: 1, name: 'a', description: '', state: 'open', priority: 'normal', date_deadline: null,
  assignees: [], creator: PERSON, parent: null, subtasks: [], attachment_count: 0,
  created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z', allowed_actions: ACTIONS,
}
const ROW = {
  id: 1, name: 'a', state: 'open', priority: 'normal', date_deadline: null, assignees: [PERSON],
  source: 'personal', project: null, href: '/my-tasks/1',
}

describe('PersonalTaskSchema', () => {
  it('accepts a personal task detail', () => {
    expect(PersonalTaskSchema.parse(DETAIL).state).toBe('open')
    expect(PersonalTaskSchema.parse({ ...DETAIL, parent: { id: 3, name: 'p' } }).parent).toEqual({ id: 3, name: 'p' })
  })

  // The same payload is asserted by test_serializer_shape in
  // odoo-addons/nasq_tasks/tests/test_serializers.py (ids differ, shape is identical).
  it('accepts the golden payload the Python serializer produces', () => {
    expect(PersonalTaskSchema.parse(golden)).toEqual(golden)
  })

  it('rejects unknown states, extra keys and the wrong person shape', () => {
    expect(() => PersonalTaskSchema.parse({ state: 'in_progress' })).toThrow()
    expect(() => PersonalTaskSchema.parse({ ...DETAIL, state: 'in_progress' })).toThrow()
    expect(() => PersonalTaskSchema.parse({ ...DETAIL, secret: 1 })).toThrow()
    expect(() => PersonalTaskSchema.parse({ ...DETAIL, priority: 'urgent' })).toThrow()
    expect(() => PersonalTaskSchema.parse({ ...DETAIL, creator: { id: 2, name: 'x' } })).toThrow()
    expect(() => PersonalTaskSchema.parse({ ...DETAIL, allowed_actions: { write: true } })).toThrow()
  })

  it('rejects datetimes that are not UTC ISO strings with a Z', () => {
    for (const bad of ['2026-10-13', '2026-10-13 08:00:00', '2026-10-13T08:00:00+03:00', 'tomorrow']) {
      expect(() => PersonalTaskSchema.parse({ ...DETAIL, created_at: bad })).toThrow()
      expect(() => PersonalTaskSchema.parse({ ...DETAIL, date_deadline: bad })).toThrow()
    }
    expect(() => MyTaskListItemSchema.parse({ ...ROW, date_deadline: '2026-10-13' })).toThrow()
  })

  it('lists exactly the three wire states', () => {
    expect(PersonalTaskStateSchema.options).toEqual(['open', 'done', 'cancelled'])
  })
})

describe('MyTaskListItemSchema', () => {
  it('accepts personal and project rows', () => {
    expect(MyTaskListItemSchema.parse(ROW).source).toBe('personal')
    const project = { ...ROW, source: 'project', project: { id: 3, name: 'P' }, href: '/projects/3/tasks/1' }
    expect(MyTaskListItemSchema.parse(project).project).toEqual({ id: 3, name: 'P' })
  })

  it('requires a project only on project rows', () => {
    expect(() => MyTaskListItemSchema.parse({ ...ROW, source: 'project', project: null, href: '/x' })).toThrow()
    expect(() => MyTaskListItemSchema.parse({ ...ROW, project: { id: 3, name: 'P' } })).toThrow()
  })

  it('requires href and rejects extra keys', () => {
    const { href: _href, ...noHref } = ROW
    expect(() => MyTaskListItemSchema.parse(noHref)).toThrow()
    expect(() => MyTaskListItemSchema.parse({ ...ROW, extra: 1 })).toThrow()
  })
})

describe('the other tasks shapes', () => {
  it('wraps list rows with a total', () => {
    expect(MyTaskListPageSchema.parse({ items: [ROW], total: 1 }).total).toBe(1)
    expect(() => MyTaskListPageSchema.parse({ items: [ROW], total: -1 })).toThrow()
    expect(() => MyTaskListPageSchema.parse({ items: [ROW], total: 1, next: 2 })).toThrow()
  })

  it('parses comments, attachments and conversion shapes', () => {
    const comment = { id: 5, body: 'hi', author: PERSON, created_at: '2026-10-13T00:00:00Z' }
    expect(PersonalTaskCommentSchema.parse(comment)).toEqual(comment)
    expect(PersonalTaskCommentSchema.parse({ ...comment, author: null }).author).toBeNull()
    expect(() => PersonalTaskCommentSchema.parse({ ...comment, author: { id: 2, name: 'x' } })).toThrow()
    const attachment = { id: 9, name: 'a.pdf', mimetype: 'application/pdf', url: '/web/content/9?download=true' }
    expect(PersonalTaskAttachmentSchema.parse(attachment)).toEqual(attachment)
    expect(ConvertTargetSchema.parse({ id: 3, name: 'P' })).toEqual({ id: 3, name: 'P' })
    expect(ConvertResultSchema.parse({ href: '/projects/3/tasks/1' })).toEqual({ href: '/projects/3/tasks/1' })
    expect(() => ConvertResultSchema.parse({})).toThrow()
  })
})
