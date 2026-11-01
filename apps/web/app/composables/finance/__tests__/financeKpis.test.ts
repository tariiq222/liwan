import { describe, expect, it } from 'vitest'
import { agedOwed, financeOverviewTiles } from '../financeKpis'
import { financeSetupProgress, financeSetupSteps } from '../financeSetupSteps'

const t = (key: string) => key
const n = (value: number, options?: Intl.NumberFormatOptions) => `${options?.currency ?? ''}${value}`

describe('finance overview tiles', () => {
  const figures = { receivable: { total: 14000, currency: 'SAR' }, payable: { total: 0, currency: 'SAR' }, drafts: 3, partners: 5 }

  it('shows the report totals in the company currency and the server counts', () => {
    const tiles = financeOverviewTiles(figures, t, n)
    expect(tiles.map(tile => tile.id)).toEqual(['receivable', 'payable', 'drafts', 'partners'])
    expect(tiles.find(tile => tile.id === 'receivable')).toMatchObject({ value: 'SAR14000', tone: 'success' })
    expect(tiles.find(tile => tile.id === 'payable')).toMatchObject({ value: 'SAR0', tone: 'neutral' })
    expect(tiles.find(tile => tile.id === 'drafts')).toMatchObject({ value: 3, tone: 'warning' })
    expect(tiles.find(tile => tile.id === 'partners')).toMatchObject({ value: 5, to: '/finance/partners' })
  })

  it('leaves out the tile behind a capability the viewer lacks and shows a dash for a figure still loading', () => {
    const tiles = financeOverviewTiles({ receivable: undefined, payable: undefined, drafts: null, partners: 0 }, t, n)
    expect(tiles.map(tile => tile.id)).toEqual(['drafts', 'partners'])
    expect(tiles[0]).toMatchObject({ value: null, tone: 'neutral' })
    expect(financeOverviewTiles({ ...figures, receivable: null }, t, n)[0]).toMatchObject({ id: 'receivable', value: null })
  })
})

describe('finance setup steps', () => {
  it('marks a step done once the server no longer lists it as a blocker, in the order a user fixes them', () => {
    const steps = financeSetupSteps({ blockers: ['company_registry_missing', 'zatca_not_onboarded'] })
    expect(steps.map(step => step.code)).toEqual(['vat_15_tax_missing', 'company_vat_missing', 'company_registry_missing', 'company_address_incomplete', 'zatca_not_onboarded'])
    expect(steps.filter(step => !step.done).map(step => step.code)).toEqual(['company_registry_missing', 'zatca_not_onboarded'])
    expect(financeSetupProgress({ blockers: ['company_registry_missing', 'zatca_not_onboarded'] })).toEqual({ done: 3, total: 5 })
    expect(financeSetupProgress({ blockers: [] })).toEqual({ done: 5, total: 5 })
  })
})


describe('what is owed', () => {
  const row = (name: string | null, total: number) => ({ partner: name ? { id: 1, name } : null, total })
  const report = (kind: 'receivable' | 'payable', partners: ReturnType<typeof row>[]) =>
    ({ kind, currency: 'SAR', accounts: [{ partners }] }) as unknown as Parameters<typeof agedOwed>[0]

  it('shows vendor balances as a positive amount and leaves out rows without a partner', () => {
    expect(agedOwed(report('payable', [row('Gulf Supplies', -460), row(null, 30223.33)]))).toEqual({ total: 460, currency: 'SAR' })
  })

  it('keeps the sign of what customers owe', () => {
    expect(agedOwed(report('receivable', [row('Al Noor', 750), row('Riyadh', 345)]))).toEqual({ total: 1095, currency: 'SAR' })
  })

  it('is zero, not minus zero, when nothing is open', () => {
    expect(Object.is(agedOwed(report('payable', [])).total, 0)).toBe(true)
  })
})
