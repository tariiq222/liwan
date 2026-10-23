import { describe, expect, it } from 'vitest'
import { hasNoContextSidebar } from '../noContextRoutes'

describe('hasNoContextSidebar', () => {
  it.each(['/notifications', '/notifications/'])('%s gives its width to the page', path => {
    expect(hasNoContextSidebar(path)).toBe(true)
  })

  it.each(['/account', '/account/leave', '/projects', '/settings/team/users', '/accounting', '/notification-digests/4'])('%s keeps the context sidebar', path => {
    expect(hasNoContextSidebar(path)).toBe(false)
  })
})
