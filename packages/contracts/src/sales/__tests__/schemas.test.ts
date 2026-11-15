import { describe, expect, it } from 'vitest'
import {
  SalesOrderAssignSchema,
  SalesOrderCreateSchema,
  SalesOrderLineInputSchema,
  SalesOrderListSchema,
  SalesOrderPatchSchema,
  SalesOrderSchema,
  SalesPublicQuotationSchema,
  SalesQuotationAcceptSchema,
  SalesQuotationDeclineSchema,
  SalesSettingsPatchSchema,
  SalesSettingsSchema,
} from '../index'

const LINE = {
  id: 3, kind: 'product', product: { id: 9, name: 'Haircut' }, name: 'Haircut', quantity: 2, unit: 'Units',
  unit_price: 100, discount_percent: 10, amount_untaxed: 180, amount_tax: 27, amount_total: 207,
}
const SECTION = { ...LINE, id: 4, kind: 'section', product: null, name: 'Services', quantity: 0, unit: null, unit_price: 0, discount_percent: 0, amount_untaxed: 0, amount_tax: 0, amount_total: 0 }
const ACTIONS = { edit: true, confirm: true, cancel: true, reopen: false, lock: false, unlock: false, duplicate: true, assign: false, send: true }
const ITEM = {
  id: 7, number: 'S00007', state: 'draft', locked: false, expired: false, source: 'staff', customer_answer: null, customer: { id: 5, name: 'Acme' },
  salesperson: { id: 2, name: 'Maha', user_id: 2 }, validity_date: '2026-12-14', date: '2026-11-14T08:00:00Z', terms: '',
  currency: { id: 2, name: 'SAR', symbol: 'ر.س' }, amount_untaxed: 180, amount_tax: 27, amount_total: 207,
}
const ORDER = { ...ITEM, lines: [SECTION, LINE], actions: ACTIONS }

describe('SalesOrderSchema', () => {
  it('accepts the serializer fields and refuses any other', () => {
    expect(SalesOrderSchema.parse(ORDER)).toEqual(ORDER)
    expect(Object.keys(SalesOrderSchema.shape).sort()).toEqual([
      'actions', 'amount_tax', 'amount_total', 'amount_untaxed', 'currency', 'customer', 'customer_answer', 'date', 'expired', 'id', 'lines',
      'locked', 'number', 'salesperson', 'source', 'state', 'terms', 'validity_date',
    ])
    expect(() => SalesOrderSchema.parse({ ...ORDER, state: 'sale' })).toThrow()
    expect(() => SalesOrderSchema.parse({ ...ORDER, source: 'shop' })).toThrow()
    expect(() => SalesOrderSchema.parse({ ...ORDER, actions: { ...ACTIONS, print: true } })).toThrow()
    expect(() => SalesOrderSchema.parse({ ...ORDER, actions: { ...ACTIONS, send: undefined } })).toThrow()
    expect(() => SalesOrderSchema.parse({ ...ORDER, lines: [{ ...LINE, tax_ids: [1] }] })).toThrow()
    expect(() => SalesOrderSchema.parse({ ...ORDER, validity_date: '14/12/2026' })).toThrow()
  })

  it('takes an online order without a salesperson or a validity date', () => {
    expect(SalesOrderSchema.parse({ ...ORDER, source: 'online', salesperson: null, validity_date: null }).salesperson).toBeNull()
  })

  it('carries the customer answer once the quotation was sent', () => {
    const waiting = { mode: 'accept_and_sign', acceptance_confirms: true, answer: null, answered_at: null, signed_by: null, decline_reason: null }
    expect(SalesOrderSchema.parse({ ...ORDER, state: 'sent', expired: true, customer_answer: waiting }).customer_answer).toEqual(waiting)
    const accepted = { ...waiting, answer: 'accepted', answered_at: '2026-11-15T10:00:00Z', signed_by: 'Mona' }
    expect(SalesOrderSchema.parse({ ...ORDER, customer_answer: accepted }).customer_answer?.signed_by).toBe('Mona')
    expect(() => SalesOrderSchema.parse({ ...ORDER, customer_answer: { ...waiting, mode: 'sign' } })).toThrow()
    expect(() => SalesOrderSchema.parse({ ...ORDER, customer_answer: { ...waiting, answer: 'maybe' } })).toThrow()
    expect(() => SalesOrderSchema.parse({ ...ORDER, customer_answer: { ...waiting, ip: '::1' } })).toThrow()
    expect(() => SalesOrderSchema.parse({ ...ORDER, expired: undefined })).toThrow()
  })

  it('lists orders without lines and actions in a list envelope', () => {
    expect(SalesOrderListSchema.parse({ items: [ITEM], total: 1 }).total).toBe(1)
    expect(() => SalesOrderListSchema.parse({ items: [ORDER], total: 1 })).toThrow()
    expect(() => SalesOrderListSchema.parse({ items: [], total: -1 })).toThrow()
  })
})

describe('SalesOrderLineInputSchema', () => {
  it('needs a product and a positive quantity on a product line, and a name on a section or note', () => {
    expect(SalesOrderLineInputSchema.parse({ kind: 'product', product_id: 9, quantity: 1, discount_percent: 5 })).toEqual({ kind: 'product', product_id: 9, quantity: 1, discount_percent: 5 })
    expect(SalesOrderLineInputSchema.parse({ id: 4, kind: 'note', name: 'Thanks' })).toEqual({ id: 4, kind: 'note', name: 'Thanks' })
    expect(() => SalesOrderLineInputSchema.parse({ kind: 'product', quantity: 1 })).toThrow()
    expect(() => SalesOrderLineInputSchema.parse({ kind: 'product', product_id: 9, quantity: 0 })).toThrow()
    expect(SalesOrderLineInputSchema.parse({ kind: 'product', product_id: 9, quantity: 1_000_000 }).quantity).toBe(1_000_000)
    expect(() => SalesOrderLineInputSchema.parse({ kind: 'product', product_id: 9, quantity: 1_000_001 })).toThrow()
    expect(() => SalesOrderLineInputSchema.parse({ kind: 'section', name: ' ' })).toThrow()
    expect(() => SalesOrderLineInputSchema.parse({ kind: 'product', product_id: 9, quantity: 1, discount_percent: 101 })).toThrow()
  })

  it('carries no price and no tax', () => {
    expect(() => SalesOrderLineInputSchema.parse({ kind: 'product', product_id: 9, quantity: 1, unit_price: 5 })).toThrow()
    expect(() => SalesOrderLineInputSchema.parse({ kind: 'product', product_id: 9, quantity: 1, tax_ids: [1] })).toThrow()
  })
})

describe('SalesOrderCreateSchema and SalesOrderPatchSchema', () => {
  it('needs a customer on create and anything on a patch', () => {
    const body = { customer_id: 5, validity_date: null, terms: '', lines: [{ kind: 'product', product_id: 9, quantity: 1 }] }
    expect(SalesOrderCreateSchema.parse(body)).toEqual(body)
    expect(() => SalesOrderCreateSchema.parse({ lines: [] })).toThrow()
    expect(SalesOrderPatchSchema.parse({ salesperson_id: 3 })).toEqual({ salesperson_id: 3 })
    expect(() => SalesOrderPatchSchema.parse({})).toThrow()
    expect(() => SalesOrderPatchSchema.parse({ state: 'confirmed' })).toThrow()
  })
})

describe('SalesOrderAssignSchema', () => {
  it('takes the new salesperson only', () => {
    expect(SalesOrderAssignSchema.parse({ salesperson_id: 3 })).toEqual({ salesperson_id: 3 })
    expect(() => SalesOrderAssignSchema.parse({})).toThrow()
    expect(() => SalesOrderAssignSchema.parse({ salesperson_id: 3, state: 'draft' })).toThrow()
  })
})

describe('SalesSettingsSchema', () => {
  const settings = { visibility: 'own', validity_days: 30, discount_limit_percent: 0, default_terms: '', customer_answer: 'accept', acceptance_confirms: false, revision: 1, can_manage: true }

  it('reads the settings with the revision', () => {
    expect(SalesSettingsSchema.parse(settings)).toEqual(settings)
    expect(() => SalesSettingsSchema.parse({ ...settings, visibility: 'team' })).toThrow()
    expect(() => SalesSettingsSchema.parse({ ...settings, discount_limit_percent: 12.5 })).toThrow()
    expect(() => SalesSettingsSchema.parse({ ...settings, customer_answer: 'sign' })).toThrow()
  })

  it('patches any of them with the revision, and refuses an empty patch', () => {
    expect(SalesSettingsPatchSchema.parse({ visibility: 'all', revision: 1 })).toEqual({ visibility: 'all', revision: 1 })
    expect(() => SalesSettingsPatchSchema.parse({ revision: 1 })).toThrow()
    expect(() => SalesSettingsPatchSchema.parse({ visibility: 'all' })).toThrow()
    expect(() => SalesSettingsPatchSchema.parse({ discount_limit_percent: 120, revision: 1 })).toThrow()
    expect(() => SalesSettingsPatchSchema.parse({ discount_limit_percent: 7.5, revision: 1 })).toThrow()
    expect(SalesSettingsPatchSchema.parse({ discount_limit_percent: 15, revision: 1 }).discount_limit_percent).toBe(15)
    expect(() => SalesSettingsPatchSchema.parse({ can_manage: false, revision: 1 })).toThrow()
    expect(SalesSettingsPatchSchema.parse({ customer_answer: 'accept_and_sign', acceptance_confirms: true, revision: 1 })).toEqual({ customer_answer: 'accept_and_sign', acceptance_confirms: true, revision: 1 })
    expect(() => SalesSettingsPatchSchema.parse({ customer_answer: 'sign', revision: 1 })).toThrow()
    expect(() => SalesSettingsPatchSchema.parse({ acceptance_confirms: 'yes', revision: 1 })).toThrow()
  })
})

const PUBLIC_LINE = { kind: 'product', name: 'Haircut', quantity: 2, unit: 'Units', unit_price: 100, discount_percent: 10, amount_untaxed: 180, amount_tax: 27, amount_total: 207 }
const PUBLIC = {
  id: 7, number: 'S00007', state: 'sent', expired: false, company_name: 'Liwan', customer_name: 'Acme', date: '2026-11-14T08:00:00Z', validity_date: '2026-12-14',
  terms: '', currency: { id: 2, name: 'SAR', symbol: 'ر.س' }, amount_untaxed: 180, amount_tax: 27, amount_total: 207, lines: [PUBLIC_LINE],
  answer_mode: 'accept', answer: null, answered_at: null, signed_by: null, can_accept: true, can_decline: true,
}

describe('SalesPublicQuotationSchema', () => {
  it('reads what the link holder sees and nothing else', () => {
    expect(SalesPublicQuotationSchema.parse(PUBLIC)).toEqual(PUBLIC)
    expect(SalesPublicQuotationSchema.parse({ ...PUBLIC, state: 'confirmed', answer: 'accepted', answered_at: '2026-11-15T10:00:00Z', signed_by: 'Mona', validity_date: null }).answer).toBe('accepted')
    expect(() => SalesPublicQuotationSchema.parse({ ...PUBLIC, state: 'draft' })).toThrow()
    expect(() => SalesPublicQuotationSchema.parse({ ...PUBLIC, access_token: 'x' })).toThrow()
    expect(() => SalesPublicQuotationSchema.parse({ ...PUBLIC, lines: [{ ...PUBLIC_LINE, id: 3 }] })).toThrow()
    expect(() => SalesPublicQuotationSchema.parse({ ...PUBLIC, answer_mode: 'sign' })).toThrow()
  })
})

describe('SalesQuotationAcceptSchema', () => {
  const png = btoa('a'.repeat(1024))

  it('takes the token alone, or the name with the signature', () => {
    expect(SalesQuotationAcceptSchema.parse({ access_token: 'tok' })).toEqual({ access_token: 'tok' })
    expect(SalesQuotationAcceptSchema.parse({ access_token: 'tok', signed_by: ' Mona ', signature: png }).signed_by).toBe('Mona')
    expect(() => SalesQuotationAcceptSchema.parse({ access_token: 'tok', signed_by: 'Mona' })).toThrow()
    expect(() => SalesQuotationAcceptSchema.parse({ access_token: 'tok', signature: png })).toThrow()
    expect(() => SalesQuotationAcceptSchema.parse({ signed_by: 'Mona', signature: png })).toThrow()
  })

  it('bounds the name and refuses a data URL or an oversized signature', () => {
    expect(() => SalesQuotationAcceptSchema.parse({ access_token: 'tok', signed_by: 'x'.repeat(121), signature: png })).toThrow()
    expect(() => SalesQuotationAcceptSchema.parse({ access_token: 'tok', signed_by: ' ', signature: png })).toThrow()
    expect(() => SalesQuotationAcceptSchema.parse({ access_token: 'tok', signed_by: 'Mona', signature: `data:image/png;base64,${png}` })).toThrow()
    expect(SalesQuotationAcceptSchema.parse({ access_token: 'tok', signed_by: 'Mona', signature: btoa('a'.repeat(48 * 1024)) }).signature).toBeTruthy()
    expect(() => SalesQuotationAcceptSchema.parse({ access_token: 'tok', signed_by: 'Mona', signature: btoa('a'.repeat(48 * 1024 + 3)) })).toThrow()
  })
})

describe('SalesQuotationDeclineSchema', () => {
  it('takes the token and an optional reason up to 1000 characters', () => {
    expect(SalesQuotationDeclineSchema.parse({ access_token: 'tok' })).toEqual({ access_token: 'tok' })
    expect(SalesQuotationDeclineSchema.parse({ access_token: 'tok', reason: 'x'.repeat(1000) }).reason).toHaveLength(1000)
    expect(() => SalesQuotationDeclineSchema.parse({ access_token: 'tok', reason: 'x'.repeat(1001) })).toThrow()
    expect(() => SalesQuotationDeclineSchema.parse({ reason: 'no' })).toThrow()
  })
})
