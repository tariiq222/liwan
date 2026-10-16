import { recordEntryOrigin } from '../recordListOrigin'
import { describe, expect, it } from 'vitest'
import { owningListBack, recordChildTo, recordParentTo, recordSiblingTo } from '../recordListOrigin'

describe('record journey origins', () => {
  it('returns to a filtered source in another application without losing the anchor', () => {
    expect(owningListBack({ returnTo: '/my-tasks?q=%D8%B9%D9%82%D8%AF&scope=assigned#last' }, ['/projects/1/tasks', '/my-tasks']))
      .toBe('/my-tasks?q=%D8%B9%D9%82%D8%AF&scope=assigned#last')
  })

  it('carries the list through an editor without treating its returnTo as a parent record', () => {
    const origin = '/meetings/calendar?month=10&year=2026#day-15'
    expect(recordChildTo('/meetings/7/edit', { returnTo: origin }, ['/meetings', '/meetings/calendar']))
      .toEqual({ path: '/meetings/7/edit', query: { listOrigin: origin } })
    expect(recordParentTo('/meetings/7', { listOrigin: origin }, ['/meetings/calendar']))
      .toEqual({ path: '/meetings/7', query: { returnTo: origin } })
    expect(recordSiblingTo('/meetings/7/minutes', { listOrigin: origin }, ['/meetings/calendar']))
      .toEqual({ path: '/meetings/7/minutes', query: { listOrigin: origin } })
  })

  it('rejects external, repeated and unregistered destinations while preserving direct filters', () => {
    for (const returnTo of ['//outside.test/my-tasks', '/my-tasks/7', ['/my-tasks', '/my-tasks']]) {
      expect(owningListBack({ returnTo, q: 'a&b', view: 'board' }, ['/tasks', '/my-tasks'], '#position'))
        .toEqual({ path: '/tasks', query: { q: 'a&b', view: 'board' }, hash: '#position' })
    }
    expect(owningListBack({ returnTo: '/tasks?q=a%26b&returnTo=%2Ftasks&listOrigin=%2Ftasks' }, ['/tasks']))
      .toBe('/tasks?q=a%26b')
  })
})


it('preserves one known parent record and its normalized list source', () => {
  const parent = '/projects/7?returnTo=' + encodeURIComponent('/projects?q=client#rows')
  expect(recordEntryOrigin(parent, '/projects/7', ['/projects'])).toBe(parent)
  expect(recordEntryOrigin('/projects/8?returnTo=/projects', '/projects/7', ['/projects'])).toBeUndefined()
  expect(recordEntryOrigin('/projects/7?returnTo=https://evil.test', '/projects/7', ['/projects'])).toBe('/projects/7')
})
