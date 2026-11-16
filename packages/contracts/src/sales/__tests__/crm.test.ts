import { describe, expect, it } from 'vitest'
import {
  SalesOpportunityWinAmountSchema,
  SalesOpportunityWinSchema,
  SalesOrderListSchema,
  SalesOrderOpportunitySchema,
  SalesOrderSchema,
  SalesSettingsPatchSchema,
  SalesSettingsSchema,
} from '../index'

const SETTINGS = {
  visibility: 'own', validity_days: 30, discount_limit_percent: 0, default_terms: '', customer_answer: 'accept', acceptance_confirms: false,
  answered_resend: 'allow', signature_methods: 'draw_or_type', revision: 1, can_manage: true,
}
const CURRENCY = { id: 2, name: 'SAR', symbol: 'ر.س' }
const ORDER = {
  id: 1, number: 'S00001', state: 'draft', locked: false, expired: false, source: 'staff', customer_answer: null, customer: { id: 2, name: 'مؤسسة النخيل' },
  salesperson: { id: 2, name: 'Admin', user_id: 2 }, validity_date: null, date: '2026-11-14T08:00:00Z', terms: '', currency: CURRENCY,
  amount_untaxed: 0, amount_tax: 0, amount_total: 0, lines: [],
  actions: { edit: true, confirm: false, cancel: true, reopen: false, lock: false, unlock: false, duplicate: true, assign: false, send: false },
  resend_refused: false,
}
const OPPORTUNITY = { id: 5, contact_name: 'فهد الحربي', status: 'pending', active: true }

describe('the CRM settings of the bridge', () => {
  it('are absent without CRM and present with it, and bounded', () => {
    expect(SalesSettingsSchema.parse(SETTINGS)).toEqual(SETTINGS)
    const withBridge = { ...SETTINGS, opportunity_win: 'manual', opportunity_win_amount: 'total' }
    expect(SalesSettingsSchema.parse(withBridge)).toEqual(withBridge)
    for (const bad of [{ opportunity_win: 'never' }, { opportunity_win: true }, { opportunity_win_amount: 'net' }, { opportunity_win_amount: 1 }]) {
      expect(() => SalesSettingsSchema.parse({ ...withBridge, ...bad })).toThrow()
      expect(() => SalesSettingsPatchSchema.parse({ revision: 1, ...bad })).toThrow()
    }
  })

  it('are written with the revision, one at a time', () => {
    expect(SalesSettingsPatchSchema.parse({ revision: 2, opportunity_win: 'order_confirmed' })).toEqual({ revision: 2, opportunity_win: 'order_confirmed' })
    expect(SalesSettingsPatchSchema.parse({ revision: 2, opportunity_win_amount: 'untaxed' })).toEqual({ revision: 2, opportunity_win_amount: 'untaxed' })
    expect(() => SalesSettingsPatchSchema.parse({ revision: 2 })).toThrow()
  })

  it('name exactly the choices the server accepts', () => {
    expect(SalesOpportunityWinSchema.options).toEqual(['order_confirmed', 'manual'])
    expect(SalesOpportunityWinAmountSchema.options).toEqual(['untaxed', 'total'])
  })
})

describe('the opportunity of an order', () => {
  it('is absent without the bridge, null without a link or a CRM right, and strict when named', () => {
    expect(SalesOrderSchema.parse(ORDER).opportunity).toBeUndefined()
    expect(SalesOrderSchema.parse({ ...ORDER, opportunity: null }).opportunity).toBeNull()
    expect(SalesOrderSchema.parse({ ...ORDER, opportunity: OPPORTUNITY }).opportunity).toEqual(OPPORTUNITY)
    for (const bad of [{ status: 'closed' }, { active: 'yes' }, { id: 0 }, { stage: 'new' }]) {
      expect(() => SalesOrderOpportunitySchema.parse({ ...OPPORTUNITY, ...bad })).toThrow()
    }
  })

  it('does not change the list row, which the opportunity page reads with the Sales list shape', () => {
    const { lines: _lines, actions: _actions, resend_refused: _refused, ...row } = ORDER
    expect(SalesOrderListSchema.parse({ items: [row], total: 1 }).items).toHaveLength(1)
    expect(() => SalesOrderListSchema.parse({ items: [{ ...row, opportunity: OPPORTUNITY }], total: 1 })).toThrow()
  })
})
