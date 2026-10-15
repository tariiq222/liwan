import { describe, expect, it } from 'vitest'
import * as presentation from '../workspacePresentation'

describe('workspacePresentation', () => {
  it('exports only the plain-route predicate', () => {
    // The overlay background derivation is deleted: a record's parent is path
    // arithmetic now, so nothing has to guess what sat behind a sheet.
    expect(Object.keys(presentation).sort()).toEqual(['isPlainRoute'])
  })

  it('keeps chat, login and meeting print off the workspace theme', () => {
    for (const path of ['/chat', '/chat/7', '/chat/new', '/login', '/meetings/7/print']) {
      expect(presentation.isPlainRoute(path), path).toBe(true)
    }
    for (const path of ['/projects', '/projects/7/tasks', '/hr', '/tasks/7', '/settings/users', '/notifications', '/account', '/search', '/reports']) {
      expect(presentation.isPlainRoute(path), path).toBe(false)
    }
  })
})
