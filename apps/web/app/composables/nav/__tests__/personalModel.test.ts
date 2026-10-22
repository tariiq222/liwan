import { describe, expect, it } from 'vitest'
import * as model from '../personalModel'
import { withManifests } from '../../../modules/manifests'
import { activeShellModule } from '../activeRoute'
import type { AppManifest } from '../../../modules/types'

const identity = (caps: string[], features = ['desk.enabled', 'desk.pay']) => ({
  capabilities: caps, platform: { readable_features: features, writable_features: features },
})
const desk: AppManifest = {
  id: 'desk', feature: 'desk.enabled', routePrefixes: ['/desk', '/account/leave', '/account/pay'],
  rail: [{ id: 'desk', labelKey: 'desk.title', icon: 'i-lucide-inbox', to: '/desk', order: 10 }], nav: [],
  routeCapabilities: [
    { pattern: /^\/account\/leave/, capability: 'desk.leave.read' },
    { pattern: /^\/account\/pay/, capability: 'desk.employee.read', feature: 'desk.pay' },
  ],
  personal: [
    { id: 'desk-pay', section: 'pay', labelKey: 'desk.pay', descriptionKey: 'desk.payDesc', icon: 'i-lucide-receipt', to: '/account/pay', capability: 'desk.employee.read', feature: 'desk.pay' },
    { id: 'desk-leave', section: 'leave', labelKey: 'desk.leave', descriptionKey: 'desk.leaveDesc', icon: 'i-lucide-calendar', to: '/account/leave', capability: 'desk.leave.read' },
  ],
}

describe('personal employee destinations', () => {
  it('keeps application-owned personal routes outside the application rail selection', () => {
    withManifests([desk], () => {
      expect(activeShellModule('/account/leave')).toBeNull()
      expect(activeShellModule('/ACCOUNT/leave?scope=mine')).toBeNull()
    })
  })

  it('provides a permission-filtered personal destination model', () => {
    expect(model).toHaveProperty('personalEntries', expect.any(Function))
  })

  it('uses a stable personal order rather than application declaration order', () => {
    withManifests([desk], () => {
      expect(model.personalEntries(identity(['desk.leave.read', 'desk.employee.read'])).map(entry => entry.section)).toEqual(['leave', 'pay'])
    })
  })

  it('hides missing capabilities, features and explicit additional capabilities', () => {
    withManifests([desk], () => {
      expect(model.personalEntries(identity(['desk.employee.read'], ['desk.enabled']))).toEqual([])
      expect(model.personalEntries(identity(['desk.leave.read'], []))).toEqual([])
      expect(model.personalEntries(undefined)).toEqual([])
    })
    withManifests([{ ...desk, personal: [{ ...desk.personal![0]!, requiredCapabilities: ['desk.documents.read'] }] }], () => {
      expect(model.personalEntries(identity(['desk.employee.read']))).toEqual([])
      expect(model.personalEntries(identity(['desk.employee.read', 'desk.documents.read']))).toHaveLength(1)
    })
  })

  it('does not leak registry section identifiers into visible sidebar headings', () => {
    withManifests([desk], () => {
      const links = model.personalContextLinks(identity(['desk.leave.read', 'desk.employee.read']))
      expect(links.every(link => !link.section)).toBe(true)
    })
  })

  it('checks the target route in addition to a contribution capability', () => {
    withManifests([{ ...desk, personal: [{ ...desk.personal![1]!, capability: 'desk.employee.read' }] }], () => {
      expect(model.personalEntries(identity(['desk.employee.read']))).toEqual([])
    })
  })
})
