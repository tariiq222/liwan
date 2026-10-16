import { describe, expect, it } from 'vitest'
import { decideAccess } from '../routeAccess'

const me = { capabilities: ['vendor.read'] }

describe('decideAccess', () => {
  it('lets a signed-out visitor reach only public pages', () => {
    expect(decideAccess({ isPublic: true, me: null, fullPath: '/enroll' })).toEqual({ action: 'allow' })
    expect(decideAccess({ isPublic: false, me: null, fullPath: '/customers?q=a' }))
      .toEqual({ action: 'login', next: '/customers?q=a' })
  })

  it('sends the signed-out visitor of the home page to a bare login', () => {
    expect(decideAccess({ isPublic: false, me: null, fullPath: '/' })).toEqual({ action: 'login' })
  })

  it('never carries an unsafe path in next', () => {
    expect(decideAccess({ isPublic: false, me: null, fullPath: '//evil.example' })).toEqual({ action: 'login' })
  })

  it('bounces a signed-in visitor of the login page to where they were going', () => {
    expect(decideAccess({ isPublic: true, me, fullPath: '/login?next=/audit', path: '/login', next: '/audit' })).toEqual({ action: 'redirect', to: '/audit' })
    expect(decideAccess({ isPublic: true, me, fullPath: '/login', path: '/login', next: '//evil.example' })).toEqual({ action: 'redirect', to: '/' })
  })

  it('lets a signed-in visitor open another public page', () => {
    expect(decideAccess({ isPublic: true, me, fullPath: '/enroll', path: '/enroll' })).toEqual({ action: 'allow' })
  })

  it('requires the page capability', () => {
    expect(decideAccess({ isPublic: false, me, fullPath: '/audit', capability: 'vendor.audit.read' })).toEqual({ action: 'forbidden' })
    expect(decideAccess({ isPublic: false, me, fullPath: '/customers', capability: 'vendor.read' })).toEqual({ action: 'allow' })
    expect(decideAccess({ isPublic: false, me, fullPath: '/' })).toEqual({ action: 'allow' })
  })
})
