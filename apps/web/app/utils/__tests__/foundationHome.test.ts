import { describe, expect, it } from 'vitest'
import { postLoginPath, canReachPath } from '../accessPolicy'
import { visibleShellModules } from '../../composables/nav/shellModules'
import { activeShellModule, contextModuleFor } from '../../composables/nav/activeRoute'

describe('foundation home', () => {
  const identity = { capabilities: [], platform: { readable_features: [], writable_features: [] } }
  it('is the internal landing without PMO, chat or another application', () => {
    expect(postLoginPath(identity, undefined)).toBe('/')
    expect(canReachPath(identity, '/')).toBe(true)
    expect(visibleShellModules(identity).map(item => item.to)).toEqual(['/'])
    expect(activeShellModule('/')).toBe('home')
    expect(contextModuleFor('home')).toBeNull()
  })
  it('rejects an unavailable next and keeps an allowed foundation destination', () => {
    expect(postLoginPath(identity, '/projects')).toBe('/')
    expect(postLoginPath(identity, '/account')).toBe('/account')
  })
})
