import { describe, expect, it } from 'vitest'
import { assetActions } from '../assetActions'

describe('asset actions', () => {
  it('lets a manager run a draft only', () => {
    const can = (capability: string) => capability === 'finance.assets.manage'
    expect(assetActions({ state: 'draft' }, can)).toEqual({ validate: true })
    for (const state of ['open', 'close', 'removed'] as const) expect(assetActions({ state }, can).validate).toBe(false)
  })

  it('offers nothing without the capability', () => {
    expect(assetActions({ state: 'draft' }, () => false).validate).toBe(false)
  })
})
