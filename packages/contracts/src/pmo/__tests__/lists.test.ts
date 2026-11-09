import { describe, expect, it } from 'vitest'
import {
  MilestoneListSchema, MilestoneSchema, PersonalStageListSchema, PersonalStageSchema,
  ProjectUpdateListSchema, ProjectUpdateSchema, TagListSchema,
} from '../index'

const MILESTONE = MilestoneSchema.parse({
  id: 1, name: 'M', deadline: null, is_reached: false, reached_date: null, task_count: 0, done_task_count: 0,
})
const UPDATE = ProjectUpdateSchema.parse({
  id: 1, name: 'W1', status: 'on_track', description_html: '<p>x</p>', date: '2030-01-01', author: { id: 2, name: 'M' },
})
const STAGE = PersonalStageSchema.parse({ id: 1, name: 'Inbox', sequence: 1, fold: false })
const TAG = { id: 1, name: 'urgent', color: 2 }

describe('the four pmo list envelopes', () => {
  it.each([
    ['MilestoneListSchema', MilestoneListSchema, MILESTONE],
    ['ProjectUpdateListSchema', ProjectUpdateListSchema, UPDATE],
    ['PersonalStageListSchema', PersonalStageListSchema, STAGE],
    ['TagListSchema', TagListSchema, TAG],
  ] as const)('%s requires items and a true total', (_name, schema, row) => {
    expect(schema.parse({ items: [row], total: 51 }).total).toBe(51)
    expect(schema.parse({ items: [], total: 0 })).toEqual({ items: [], total: 0 })
    // A bare array is the shape these routes used to answer; it is no longer accepted.
    expect(schema.safeParse([row]).success).toBe(false)
    expect(schema.safeParse({ items: [row] }).success).toBe(false)
    expect(schema.safeParse({ items: [row], total: -1 }).success).toBe(false)
    expect(schema.safeParse({ items: [row], total: 1, extra: true }).success).toBe(false)
  })
})
