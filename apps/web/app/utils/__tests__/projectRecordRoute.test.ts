import { describe, expect, it } from 'vitest'
import { isProjectRecordPath } from '../projectRecordRoute'

describe('isProjectRecordPath', () => {
  it.each([
    '/projects/1/tasks/5', '/projects/1/tasks/5/', '/projects/12/milestones/3',
    '/projects/1/meetings/9', '/projects/1/updates/4',
  ])('%s is a record', (path) => expect(isProjectRecordPath(path)).toBe(true))

  it.each([
    '/projects/1', '/projects/1/tasks', '/projects/1/tasks/new', '/projects/1/milestones/new',
    '/projects/1/milestones/3/edit', '/projects/1/updates/new', '/projects/1/settings', '/projects/1/finance/3',
    '/tasks/5', '/projects/x/tasks/5',
  ])('%s keeps the project frame', (path) => expect(isProjectRecordPath(path)).toBe(false))
})
