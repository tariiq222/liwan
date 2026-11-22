import { describe, expect, it } from 'vitest'
import ar from '../../../i18n/locales/ar/vendor.json'
import en from '../../../i18n/locales/en/vendor.json'
import { OWNER_ONLY_ACTIONS, ownerOnlyAccess, ownerOnlyTextKey } from '../ownerOnly'

const holding = (...held: string[]) => (capability: string) => held.includes(capability)

describe('owner-only actions', () => {
  it('names the two grants each action needs', () => {
    const both = {
      customTerms: ['vendor.pricing.manage', 'vendor.subscriptions.manage'],
      restorePublication: ['vendor.operations.run', 'vendor.tenants.manage'],
      sharedOnboarding: ['vendor.operations.run', 'vendor.tenants.manage'],
      voidInvoice: ['vendor.billing.manage', 'vendor.subscriptions.manage'],
    }
    expect(OWNER_ONLY_ACTIONS.sort()).toEqual(Object.keys(both).sort())
    for (const [action, grants] of Object.entries(both)) {
      const can = (names: string[]) => ownerOnlyAccess(action as never, holding(...names) as never)
      expect(can(grants), action).toBe('granted')
      expect(can([grants[0]!]), action).toBe('partial')
      expect(can([grants[1]!]), action).toBe('partial')
      expect(can(['vendor.read']), action).toBe('none')
    }
  })
  it('has a text for every action in both locales that says both grants are needed and the platform owner does it', () => {
    for (const action of OWNER_ONLY_ACTIONS) {
      const path = ownerOnlyTextKey(action).split('.')
      for (const [name, messages] of [['ar', ar], ['en', en]] as const) {
        const text = path.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], messages)
        expect(typeof text === 'string' && text.length > 20, `${name} ${action}`).toBe(true)
      }
    }
  })
})
