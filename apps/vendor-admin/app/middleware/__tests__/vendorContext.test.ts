import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

describe('10.vendor-context.global', () => {
  it('waits for the first context load and then refreshes before the page renders', async () => {
    const order: string[] = []
    vi.stubGlobal('defineNuxtRouteMiddleware', (handler: unknown) => handler)
    vi.stubGlobal('useVendorContext', () => ({
      ready: Promise.resolve().then(() => { order.push('ready') }),
      refresh: () => { order.push('refresh'); return Promise.resolve() },
    }))

    const { default: middleware } = await import('../10.vendor-context.global')
    await (middleware as unknown as () => Promise<void>)()

    expect(order).toEqual(['ready', 'refresh'])
  })
})
