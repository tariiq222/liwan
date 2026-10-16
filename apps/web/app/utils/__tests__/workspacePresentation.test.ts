import { describe, expect, it } from 'vitest'
import * as presentation from '../workspacePresentation'

describe('workspacePresentation', () => {
  it('exports only the page-area classifier', () => {
    // The overlay background derivation is deleted: a record's parent is path
    // arithmetic now, so nothing has to guess what sat behind a sheet.
    expect(Object.keys(presentation).sort()).toEqual(['pageArea'])
  })

  it('keeps chat, login and meeting print off the workspace theme', () => {
    for (const path of ['/chat', '/chat/7', '/chat/new', '/login', '/meetings/7/print']) {
      expect(presentation.pageArea(path).plain, path).toBe(true)
    }
    for (const path of ['/projects', '/projects/7/tasks', '/hr', '/tasks/7', '/settings/users', '/notifications', '/account', '/search', '/reports']) {
      expect(presentation.pageArea(path).plain, path).toBe(false)
    }
  })

  it('marks project records', () => {
    expect(presentation.pageArea('/projects')).toEqual({ plain: false, record: false })
    expect(presentation.pageArea('/settings/projects/catalogs')).toEqual({ plain: false, record: false })
    expect(presentation.pageArea('/projects/7/tasks')).toEqual({ plain: false, record: true })
    expect(presentation.pageArea('/projects/dashboard')).toEqual({ plain: false, record: false })
    expect(presentation.pageArea('/tasks/7')).toEqual({ plain: false, record: false })
  })
})
