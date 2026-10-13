import { TasksRecordListSchema, TasksRecordSchema } from '../index'

const RECORD = { id: 1, name: 'First record' }

describe('TasksRecordSchema', () => {
  it('is strict: it accepts exactly id and name', () => {
    expect(TasksRecordSchema.parse(RECORD)).toEqual(RECORD)
    expect(Object.keys(TasksRecordSchema.shape).sort()).toEqual(['id', 'name'])
    expect(() => TasksRecordSchema.parse({ ...RECORD, secret: 'x' })).toThrow()
  })

  it('rejects a missing name and a non-positive id', () => {
    expect(() => TasksRecordSchema.parse({ id: 1 })).toThrow()
    expect(() => TasksRecordSchema.parse({ ...RECORD, id: 0 })).toThrow()
  })
})

describe('TasksRecordListSchema', () => {
  it('wraps records with a total and rejects extra keys', () => {
    expect(TasksRecordListSchema.parse({ items: [RECORD], total: 1 })).toEqual({ items: [RECORD], total: 1 })
    expect(() => TasksRecordListSchema.parse({ items: [RECORD], total: 1, next: 2 })).toThrow()
    expect(() => TasksRecordListSchema.parse({ items: [RECORD], total: -1 })).toThrow()
  })
})
