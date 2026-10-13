import { describe, expect, it } from 'vitest'
import { buildMyTaskPayload, myTaskFormField, validateMyTaskName, type MyTaskFormValues } from '../myTaskPayload'

const values = (over: Partial<MyTaskFormValues> = {}): MyTaskFormValues => ({
  name: '  Write report ', description: '', deadline: null, priority: 'normal', assignees: [], ...over,
})

describe('buildMyTaskPayload', () => {
  it('creates with only the name and the priority when optionals are empty', () => {
    expect(buildMyTaskPayload(values())).toEqual({ name: 'Write report', priority: 'normal' })
  })

  it('includes every filled optional, trims text and never sends parent_id', () => {
    const body = buildMyTaskPayload(values({ description: ' Notes ', deadline: '2026-10-20', priority: 'high', assignees: [3, 5] }))
    expect(body).toEqual({ name: 'Write report', description: 'Notes', date_deadline: '2026-10-20', priority: 'high', assignees: [3, 5] })
    expect(body).not.toHaveProperty('parent_id')
  })
})

describe('validateMyTaskName', () => {
  it('requires a non-blank name of at most 255 characters', () => {
    expect(validateMyTaskName('   ')).toBe('required')
    expect(validateMyTaskName('a'.repeat(256))).toBe('tooLong')
    expect(validateMyTaskName('a'.repeat(255))).toBeNull()
  })
})

describe('myTaskFormField', () => {
  it('names the shown field of a server error and resolves the user_ids alias', () => {
    for (const field of ['name', 'description', 'date_deadline', 'priority', 'assignees']) expect(myTaskFormField(field)).toBe(field)
    expect(myTaskFormField('user_ids')).toBe('assignees')
  })
  it('returns null for no field or a field the form does not show', () => {
    expect(myTaskFormField(undefined)).toBeNull()
    expect(myTaskFormField(null)).toBeNull()
    expect(myTaskFormField('parent_id')).toBeNull()
  })
})
