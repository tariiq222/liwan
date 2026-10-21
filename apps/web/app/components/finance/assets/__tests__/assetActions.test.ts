import { describe, expect, it } from 'vitest'
import { assetActions } from '../assetActions'

describe('asset actions', () => {
  it('lets a manager run a draft only', () => {
    const can = (capability: string) => capability === 'finance.assets.manage'
    expect(assetActions({ state: 'draft' }, can)).toEqual({ validate: true, dispose: false })
    for (const state of ['open', 'close', 'removed'] as const) expect(assetActions({ state }, can).validate).toBe(false)
  })

  it('offers nothing without the capability', () => {
    expect(assetActions({ state: 'draft' }, () => false).validate).toBe(false)
  })

  const can = (capability: string) => capability === 'finance.assets.manage'
  it('offers disposal on a running or fully depreciated asset, to asset managers only', () => {
    for (const state of ['open', 'close'] as const) expect(assetActions({ state }, can)).toEqual({ validate: false, dispose: true })
    for (const state of ['draft', 'removed'] as const) expect(assetActions({ state }, can).dispose).toBe(false)
    expect(assetActions({ state: 'open' }, () => false).dispose).toBe(false)
  })
})
