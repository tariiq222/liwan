import { describe, expect, it } from 'vitest'
import { canReachPath } from '../../utils/accessPolicy'
import { manifestForPath, settingsPartForPath } from '../manifests'
import { canUse } from '../registry'

// The products manifest: which route needs which capability, with the products feature on and writable or read-only.
const tenant = (capabilities: string[], writable = true) => ({
  capabilities,
  platform: { readable_features: ['products.enabled'], writable_features: writable ? ['products.enabled'] : [] },
})
const reachable = (path: string, capabilities: string[], writable = true) => canReachPath(tenant(capabilities, writable), path)

describe('products manifest', () => {
  it('claims /products and the settings page, behind products.enabled', () => {
    expect(manifestForPath('/products/7/edit')?.id).toBe('products')
    expect(manifestForPath('/products/7/edit')?.feature).toBe('products.enabled')
    expect(settingsPartForPath('/settings/apps/products')?.part.id).toBe('sharing')
  })

  it('opens the list and a record to a reader, and the create page to a manager only', () => {
    expect(reachable('/products', ['products.read'])).toBe(true)
    expect(reachable('/products/7', ['products.read'])).toBe(true)
    expect(reachable('/products/new', ['products.read'])).toBe(false)
    expect(reachable('/products/new', ['products.read', 'products.manage'])).toBe(true)
    expect(reachable('/products', [])).toBe(false)
  })

  it('opens the edit page to a holder of the price right alone', () => {
    expect(reachable('/products/7/edit', ['products.read', 'products.manage'])).toBe(true)
    expect(reachable('/products/7/edit', ['products.read', 'products.prices.manage'])).toBe(true)
    expect(reachable('/products/7/edit', ['products.read'])).toBe(false)
  })

  it('keeps the pages of a read-only tenant but closes every write', () => {
    expect(reachable('/products', ['products.read'], false)).toBe(true)
    expect(reachable('/products/new', ['products.read', 'products.manage'], false)).toBe(false)
    expect(reachable('/products/7/edit', ['products.read', 'products.prices.manage'], false)).toBe(false)
    expect(canUse(tenant(['products.manage'], false), 'products.manage')).toBe(false)
    expect(canUse(tenant(['products.prices.manage'], true), 'products.prices.manage')).toBe(true)
  })

  it('opens the settings page to the settings right', () => {
    expect(reachable('/settings/apps/products', ['products.settings.manage'])).toBe(true)
    expect(reachable('/settings/apps/products', ['products.read'])).toBe(false)
  })
})
