import { describe, expect, it } from 'vitest'
import { buildMyTaskPayload, deadlineToDateInput, myTaskFormField, validateMyTaskName, type MyTaskFormValues } from '../myTaskPayload'

const values = (over: Partial<MyTaskFormValues> = {}): MyTaskFormValues => ({
  name: '  Write report ', description: '', deadline: null, priority: 'normal', assignees: [], ...over,
})

describe('buildMyTaskPayload', () => {
  it('creates with only the name and the priority when optionals are empty', () => {
    expect(buildMyTaskPayload(values(), 'create')).toEqual({ name: 'Write report', priority: 'normal' })
  })

  it('includes every filled optional, trims text and never sends parent_id', () => {
    const body = buildMyTaskPayload(values({ description: ' Notes ', deadline: '2026-10-20', priority: 'high', assignees: [3, 5] }), 'create')
    expect(body).toEqual({ name: 'Write report', description: 'Notes', date_deadline: '2026-10-20', priority: 'high', assignees: [3, 5] })
    expect(body).not.toHaveProperty('parent_id')
  })

  it('sends cleared fields on edit so they can be emptied', () => {
    expect(buildMyTaskPayload(values(), 'edit')).toEqual({
      name: 'Write report', description: '', date_deadline: null, priority: 'normal', assignees: [],
    })
  })
})

describe('deadlineToDateInput', () => {
  it('keeps the UTC calendar day of the wire instant, whatever the local zone', () => {
    expect(deadlineToDateInput('2026-10-20T00:00:00Z')).toBe('2026-10-20')
    expect(deadlineToDateInput('2026-10-20T23:30:00Z')).toBe('2026-10-20')
  })
  it('returns null for an empty or malformed value', () => {
    expect(deadlineToDateInput(null)).toBeNull()
    expect(deadlineToDateInput('nonsense')).toBeNull()
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
