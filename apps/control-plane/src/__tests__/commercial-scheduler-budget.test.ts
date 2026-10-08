import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const collect = vi.fn(async (_pool: unknown, _input: Record<string, unknown>) => ({ recorded: 0, skipped: 0, locked: false, busy: false }))
vi.mock('../commercial/usage-collector.js', async importOriginal => ({ ...await importOriginal<typeof import('../commercial/usage-collector.js')>(), collectUsage: collect }))

const { createCommercialScheduler, usageBudgetMs, USAGE_MAX_INTERVAL_MS } = await import('../commercial/scheduler.js')
const { BUDGET_MS, PER_TENANT_MS, FRESH_MS: COLLECTOR_FRESH_MS } = await import('../commercial/usage-collector.js')

// usage.ts keeps FRESH_MS private; read the literal so this test breaks if it changes.
const FRESH_MS = (() => {
  const m = /const FRESH_MS = (\d+) \* (\d+) \* (\d+)/.exec(readFileSync(new URL('../commercial/usage.ts', import.meta.url), 'utf8'))
  if (!m) throw new Error('FRESH_MS not found')
  return Number(m[1]) * Number(m[2]) * Number(m[3])
})()

describe('usage collection budget', () => {
  it('is 80% of the interval, and the default matches the default 300 s interval', () => {
    expect(usageBudgetMs(300_000)).toBe(240_000)
    expect(BUDGET_MS).toBe(usageBudgetMs(300_000))
  })

  it('relates interval, budget, per-tenant deadline and freshness at the default interval', () => {
    const interval = 300_000
    const budget = usageBudgetMs(interval)
    expect(PER_TENANT_MS).toBe(30_000)
    expect(budget).toBeLessThan(interval)                    // a run ends before the next one is due
    expect(budget + PER_TENANT_MS).toBeLessThanOrEqual(interval) // even the last tenant's deadline fits the interval
    // A tenant sampled early in one run and late in the next is still fresh enough for a downgrade check.
    expect(interval + budget).toBeLessThan(FRESH_MS)
    expect(budget / PER_TENANT_MS).toBeGreaterThanOrEqual(8)   // at least 8 tenants per run even at the per-tenant deadline
  })

  it('caps the interval so interval + budget stays inside the freshness window, even at the cap', () => {
    expect(COLLECTOR_FRESH_MS).toBe(FRESH_MS)
    expect(USAGE_MAX_INTERVAL_MS).toBe(500_000)
    expect(USAGE_MAX_INTERVAL_MS + usageBudgetMs(USAGE_MAX_INTERVAL_MS)).toBeLessThanOrEqual(FRESH_MS)
  })

  it('passes the budget derived from the effective (clamped) interval to the collector', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const pool = { connect: async () => ({ query: async () => ({ rows: [{ ok: true }] }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) }
    for (const [env, expected] of [[{}, 240_000], [{ NASQ_COMMERCIAL_USAGE_INTERVAL_SEC: '100' }, 80_000], [{ NASQ_COMMERCIAL_USAGE_INTERVAL_SEC: '99999' }, 400_000]] as const) {
      collect.mockClear()
      const scheduler = createCommercialScheduler({ pool: pool as never, config: {} as never, env, log: () => {}, usageRunner: async () => null })
      await scheduler.tick(); await scheduler.usageIdle()
      expect(collect.mock.calls[0]![1].budget_ms).toBe(expected)
    }
  })
})
