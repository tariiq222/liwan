import { describe, expect, it } from 'vitest'
import { appStartFor, serviceGroups } from '../servicesStartModel'
import { withManifests } from '../../../modules/manifests'
import type { AppManifest } from '../../../modules/types'

const everyService = ['hr.leave.request', 'hr.leave.read', 'hr.employees.read', 'operations.requests.create', 'operations.requests.read', 'operations.requests.review']
const identity = (capabilities: string[], platform?: { readable: string[]; writable?: string[] }) => ({
  role: 'employee',
  capabilities: ['webvue.internal', ...capabilities],
  ...(platform ? { platform: { readable_features: platform.readable, writable_features: platform.writable ?? platform.readable } } : {}),
})

describe('serviceGroups', () => {
  it('groups the services by application, in rail order, titled with the application\'s rail label', () => {
    const groups = serviceGroups(identity(everyService))
    expect(groups.map(group => group.id)).toEqual(['hr', 'operations'])
    expect(groups.map(group => group.labelKey)).toEqual(['nav.hr', 'operations.title'])
    expect(groups[0]!.entries.map(entry => entry.id)).toEqual(['hr-leave-new', 'hr-leave-mine', 'hr-payslips-mine', 'hr-assets-mine'])
    expect(groups[1]!.entries.map(entry => entry.id)).toEqual(['operations-new', 'operations-mine', 'operations-pending'])
  })

  it('hides an entry the user lacks the capability for, and a group left with none', () => {
    const groups = serviceGroups(identity(['hr.leave.read', 'operations.requests.read']))
    expect(groups.flatMap(group => group.entries.map(entry => entry.id))).toEqual(['hr-leave-mine', 'operations-mine'])
    expect(serviceGroups(identity(['operations.requests.create'])).map(group => group.id)).toEqual(['operations'])
  })

  it('shows the review entry only to a reviewer', () => {
    const ids = (caps: string[]) => serviceGroups(identity(caps)).flatMap(group => group.entries.map(entry => entry.id))
    expect(ids(['operations.requests.read'])).not.toContain('operations-pending')
    expect(ids(['operations.requests.read', 'operations.requests.review'])).toContain('operations-pending')
  })

  it('hides every entry of an application whose feature is off', () => {
    const groups = serviceGroups(identity(everyService, { readable: ['operations.enabled'] }))
    expect(groups.map(group => group.id)).toEqual(['operations'])
  })

  it('keeps own payslips behind the payroll sub-feature, and own custody behind the assets one', () => {
    const ids = (readable: string[]) => serviceGroups(identity(['hr.employees.read'], { readable })).flatMap(group => group.entries.map(entry => entry.id))
    expect(ids(['hr.enabled'])).toEqual([])
    expect(ids(['hr.enabled', 'hr.payroll'])).toEqual(['hr-payslips-mine'])
    expect(ids(['hr.enabled', 'hr.assets', 'hr.payroll'])).toEqual(['hr-payslips-mine', 'hr-assets-mine'])
  })

  it('declares no payroll entry beyond the user\'s own payslips', () => {
    const all = serviceGroups(identity(everyService)).flatMap(group => group.entries)
    expect(all.filter(entry => entry.to.startsWith('/hr/payroll')).map(entry => entry.to)).toEqual(['/hr/payroll/mine'])
  })

  it('is empty without an identity or without any service capability', () => {
    expect(serviceGroups(undefined)).toEqual([])
    expect(serviceGroups(identity([]))).toEqual([])
  })
})

const sales: AppManifest = {
  id: 'sales', feature: 'sales.enabled', routePrefixes: ['/sales'],
  rail: [{ id: 'sales', labelKey: 'nav.sales', icon: 'i-lucide-receipt', to: '/sales', order: 90 }],
  nav: [
    { to: '/sales', labelKey: 'sales.orders', icon: 'i-lucide-receipt', shortcut: '', capability: 'sales.orders.read' },
    { to: '/sales/quotes', labelKey: 'sales.quotes', icon: 'i-lucide-file-text', shortcut: '', capability: 'sales.quotes.read' },
  ],
  contextLinks: () => [
    { id: 'new-order', labelKey: 'sales.newOrder', icon: 'i-lucide-plus', to: '/sales/new', capability: 'sales.orders.create', pinned: true },
    { id: 'orders', labelKey: 'sales.orders', icon: 'i-lucide-receipt', to: '/sales', capability: 'sales.orders.read', pinned: true },
    { id: 'quotes', labelKey: 'sales.quotes', icon: 'i-lucide-file-text', to: '/sales/quotes', capability: 'sales.quotes.read' },
  ],
}

describe('serviceGroups route rules', () => {
  const desk: AppManifest = {
    id: 'desk', feature: 'desk.enabled', routePrefixes: ['/desk'],
    rail: [{ id: 'desk', labelKey: 'nav.desk', icon: 'i-lucide-inbox', to: '/desk', order: 95 }],
    nav: [],
    routeCapabilities: [{ pattern: /^\/desk\/review$/, capability: 'desk.review' }],
    services: [{ id: 'desk-review', labelKey: 'desk.review', descriptionKey: 'desk.reviewDesc', icon: 'i-lucide-inbox', to: '/desk/review', capability: 'desk.read' }],
  }

  it('hides an entry whose own capability is granted but whose target route needs another one', () => {
    withManifests([desk], () => {
      expect(serviceGroups(identity(['desk.read']))).toEqual([])
      expect(serviceGroups(identity(['desk.read', 'desk.review'])).flatMap(group => group.entries.map(entry => entry.id))).toEqual(['desk-review'])
    })
  })
})

describe('appStartFor', () => {
  it('is unknown for an id no application declares', () => {
    withManifests([sales], () => expect(appStartFor('nope', identity(['sales.orders.read']))).toEqual({ kind: 'unknown' }))
  })

  it('is forbidden when the user reaches none of the application\'s pages', () => {
    withManifests([sales], () => expect(appStartFor('sales', identity(['pmo.tasks.read']))).toEqual({ kind: 'forbidden' }))
    withManifests([sales], () => expect(appStartFor('sales', identity(['sales.orders.read'], { readable: ['pmo.enabled'] }))).toEqual({ kind: 'forbidden' }))
  })

  it('lists the reachable pages, then the pinned create actions the user may run, without repeating a page', () => {
    withManifests([sales], () => {
      const start = appStartFor('sales', identity(['sales.orders.read', 'sales.orders.create']))
      expect(start).toMatchObject({ kind: 'ready', id: 'sales', labelKey: 'nav.sales', icon: 'i-lucide-receipt', openTo: '/sales' })
      if (start.kind !== 'ready') throw new Error('expected a ready start page')
      expect(start.cards.map(card => card.to)).toEqual(['/sales'])
      expect(start.creates.map(card => card.to)).toEqual(['/sales/new'])
    })
  })

  it('hides a create action without its capability and a page without its capability', () => {
    withManifests([sales], () => {
      const start = appStartFor('sales', identity(['sales.orders.read', 'sales.quotes.read']))
      if (start.kind !== 'ready') throw new Error('expected a ready start page')
      expect(start.cards.map(card => card.to)).toEqual(['/sales', '/sales/quotes'])
      expect(start.creates).toEqual([])
    })
  })

  it('works for the real applications', () => {
    const start = appStartFor('operations', identity(['operations.requests.read', 'operations.requests.create']))
    if (start.kind !== 'ready') throw new Error('expected a ready start page')
    expect(start.openTo).toBe('/operations')
    expect(start.cards.map(card => card.to)).toEqual(['/operations'])
    expect(start.creates.map(card => card.to)).toEqual(['/operations/new'])
  })
})
