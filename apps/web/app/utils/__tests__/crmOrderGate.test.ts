import { describe, expect, it } from 'vitest'
import { SalesOrderStateSchema } from '@liwan/contracts'
import { recordListOrigin } from '../recordListOrigin'
import crmManifest from '../../modules/crm/manifest'
import ar from '../../../i18n/locales/ar/crm.json'
import en from '../../../i18n/locales/en/crm.json'
import { callOutcomesFor, opportunityOrderGate, OPPORTUNITY_ORDER_STATE_TONE } from '../crmOrderGate'

const record = { status: 'pending', active: true, customer: { id: 2, name: 'مؤسسة النخيل' }, win_by_order: true, can_quote: true } as const

describe('opportunityOrderGate', () => {
  it('offers the win action and the new quotation to a caller who may quote on a pending opportunity with a customer', () => {
    expect(opportunityOrderGate(record, true)).toEqual({ winByOrder: true, blocked: null, canAdd: true, winAction: true, cannotQuote: false })
  })

  it('offers the win action only while the opportunity is pending: a won one keeps the plain new quotation', () => {
    expect(opportunityOrderGate({ ...record, status: 'won' }, true)).toMatchObject({ winAction: false, canAdd: true, cannotQuote: false })
  })

  it('explains, instead of offering a dead button, when an order wins and the caller may not quote', () => {
    const gate = opportunityOrderGate({ ...record, can_quote: false }, false)
    expect(gate).toMatchObject({ winByOrder: true, winAction: false, canAdd: false, cannotQuote: true })
    // A closed opportunity needs no explanation.
    expect(opportunityOrderGate({ ...record, can_quote: false, status: 'won' }, false).cannotQuote).toBe(false)
  })

  it('blocks a quotation for a closed, archived or customerless opportunity, in that order', () => {
    expect(opportunityOrderGate({ ...record, status: 'lost', active: false }, true)).toMatchObject({ blocked: 'closed', canAdd: false, winAction: false })
    expect(opportunityOrderGate({ ...record, active: false }, true).blocked).toBe('closed')
    expect(opportunityOrderGate({ ...record, customer: null }, true)).toMatchObject({ blocked: 'noCustomer', canAdd: false, winAction: false })
  })

  it('offers no win action when no order wins, but still lets a quotation be written', () => {
    expect(opportunityOrderGate({ ...record, win_by_order: false, can_quote: false }, true)).toMatchObject({ winByOrder: false, winAction: false, cannotQuote: false, canAdd: true })
  })

  it('keeps no quotation action from a caller without the Sales right', () => {
    expect(opportunityOrderGate(record, false)).toMatchObject({ canAdd: false, winAction: false })
  })
})

describe('callOutcomesFor', () => {
  const outcomes = [{ id: 1, effect: 'follow_up' }, { id: 2, effect: 'won' }, { id: 3, effect: 'lost' }]
  it('drops the sold outcome while an order wins and keeps all of them otherwise', () => {
    expect(callOutcomesFor(outcomes, true).map(outcome => outcome.id)).toEqual([1, 3])
    expect(callOutcomesFor(outcomes, false)).toHaveLength(3)
  })
})

describe('the quotations panel', () => {
  it('names a tone and a word for exactly the states of the Sales contract, in both languages', () => {
    expect(Object.keys(OPPORTUNITY_ORDER_STATE_TONE).sort()).toEqual([...SalesOrderStateSchema.options].sort())
    for (const tree of [ar.crm.opportunities.orders.state, en.crm.opportunities.orders.state]) {
      expect(Object.keys(tree).sort()).toEqual([...SalesOrderStateSchema.options].sort())
    }
  })

  it('uses the Sales words for the states', async () => {
    const sales = await import('../../../i18n/locales/ar/sales.json')
    expect(ar.crm.opportunities.orders.state).toEqual(sales.default.sales.state)
  })
})

describe('the way back from a quotation opened from an opportunity', () => {
  const paths = ['/sales', '/crm/opportunities/7']
  it('is the opportunity, registered as a record source for readers of CRM', () => {
    const source = crmManifest.recordListSources?.find(entry => entry.pattern.test('/crm/opportunities/7'))
    expect(source?.capability).toBe('crm.leads.read')
    expect(crmManifest.recordListSources?.some(entry => entry.pattern.test('/crm/opportunities/new') || entry.pattern.test('/crm/opportunities'))).toBe(false)
    expect(recordListOrigin('/crm/opportunities/7', paths)).toBe('/crm/opportunities/7')
  })

  it('refuses another opportunity or an address outside the sources', () => {
    expect(recordListOrigin('/crm/opportunities/8', paths)).toBeUndefined()
    expect(recordListOrigin('https://evil.example/crm/opportunities/7', paths)).toBeUndefined()
  })
})
