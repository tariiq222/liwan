import { describe, expect, it } from 'vitest'
import { appStartFor } from '../appStartModel'
import { withManifests } from '../../../modules/manifests'
import type { AppManifest } from '../../../modules/types'

const identity = (capabilities: string[], platform?: { readable: string[]; writable?: string[] }) => ({
  role: 'employee',
  capabilities: ['webvue.internal', ...capabilities],
  ...(platform ? { platform: { readable_features: platform.readable, writable_features: platform.writable ?? platform.readable } } : {}),
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
