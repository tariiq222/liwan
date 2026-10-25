import { toValue } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canReach } from '../../utils/accessPolicy'
import { useHrGosiRates, useHrPayrollSettings } from '../useHrPayrollSettings'
import { useHrBankProfiles } from '../useHrPayrollFiles'
import { useHrEosCases } from '../useHrPayrollEos'
import { useHrPayrollFinanceSettings } from '../useHrPayrollFinance'

// D-6: the reads behind the payroll settings card ask the server only for a payroll reader with the hr.payroll
// sub-feature open; hr.payroll.config is not needed to read. `useAccess().can` is the real canReach over the identity,
// as useAccess.ts does, so the feature gates are the real ones. useQuery returns its options, so `enabled` is observable.
vi.mock('@tanstack/vue-query', async importOriginal => ({
  ...(await importOriginal<typeof import('@tanstack/vue-query')>()),
  useQuery: (options: unknown) => options,
}))

type Query = { enabled: unknown }
const QUERIES: [string, () => unknown][] = [
  ['settings', useHrPayrollSettings], ['gosi rates', useHrGosiRates], ['bank profiles', () => useHrBankProfiles()],
  ['end-of-service cases', useHrEosCases], ['finance settings', useHrPayrollFinanceSettings],
]
const FEATURES = ['hr.enabled', 'hr.payroll']
let identity: { capabilities: string[]; platform: { readable_features: string[]; writable_features: string[] } }
const as = (capabilities: string[], features = FEATURES) => { identity = { capabilities, platform: { readable_features: features, writable_features: features } } }

beforeEach(() => {
  vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
  vi.stubGlobal('useAccess', () => ({ can: (capability: string) => canReach(identity, capability) }))
})
afterEach(() => vi.unstubAllGlobals())

describe('payroll settings reads', () => {
  it.each(QUERIES)('%s are asked for with hr.payroll.read alone', (_name, use) => {
    as(['hr.payroll.read'])
    expect(toValue((use() as Query).enabled)).toBe(true)
  })
  it.each(QUERIES)('%s are not asked for without hr.payroll.read', (_name, use) => {
    as(['hr.employees.read', 'hr.leave.config'])
    expect(toValue((use() as Query).enabled)).toBe(false)
  })
  it.each(QUERIES)('%s are not asked for when the hr.payroll sub-feature is off', (_name, use) => {
    as(['hr.payroll.read', 'hr.payroll.config'], ['hr.enabled'])
    expect(toValue((use() as Query).enabled)).toBe(false)
  })
})
