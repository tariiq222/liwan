import { describe, expect, it } from 'vitest'
import type { InboxMessageCommerce } from '@liwan/contracts'
import {
  COMMERCE_LIMITS, addDraftSection, buildCommerceContent, cartLineRows, commerceProblem, commerceProductCount, commerceToDraft, emptyCommerceDraft, expiryCountdown, formatInboxMoney,
  imageProblem, linesTotal, normalizeCommerceDraft, orderBadge, orderLineRows, pickedIds, removeDraftSection, rowsTotal, toggleDraftProduct,
} from '../inboxCommerce'

const ids = (count: number, from = 1) => Array.from({ length: count }, (_, index) => `wv-${from + index}`)
const list = (overrides = {}) => ({ ...emptyCommerceDraft('منتجات'), header: 'عروض', body: 'اختر ما يناسبك', ...overrides })

describe('the commerce message draft', () => {
  it('builds a product list only with a header, a body, titled sections and products', () => {
    const draft = list()
    expect(buildCommerceContent(draft)).toBeNull()
    expect(commerceProblem(draft)).toBe('productsRequired')
    draft.sections[0]!.ids = ['wv-1', 'wv-2']
    expect(commerceProblem(draft)).toBeNull()
    expect(buildCommerceContent(draft)).toEqual({ type: 'product_list', header: 'عروض', body: 'اختر ما يناسبك', footer: null, sections: [{ title: 'منتجات', product_retailer_ids: ['wv-1', 'wv-2'] }] })
    draft.header = ''
    expect(commerceProblem(draft)).toBe('headerRequired')
    expect(buildCommerceContent(draft)).toBeNull()
  })

  it('applies Meta\'s limits: 60 header, 24 section title, 30 products, 10 sections', () => {
    const draft = list()
    draft.sections[0]!.ids = ['wv-1']
    draft.header = 'ع'.repeat(COMMERCE_LIMITS.header + 1)
    expect(buildCommerceContent(draft)).toBeNull()
    draft.header = 'ع'.repeat(COMMERCE_LIMITS.header)
    expect(buildCommerceContent(draft)).not.toBeNull()
    draft.sections[0]!.title = 'ع'.repeat(COMMERCE_LIMITS.sectionTitle + 1)
    expect(buildCommerceContent(draft)).toBeNull()
    expect(commerceProblem({ ...draft, sections: [{ title: '', ids: ['wv-1'] }] })).toBe('sectionTitleRequired')
    const full = list()
    for (let index = 1; index < COMMERCE_LIMITS.sections; index++) expect(addDraftSection(full)).toBe(true)
    expect(addDraftSection(full)).toBe(false)
    expect(full.sections).toHaveLength(COMMERCE_LIMITS.sections)
  })

  it('stops adding at 30 products and keeps a product once', () => {
    const draft = list()
    for (const id of ids(COMMERCE_LIMITS.products + 5)) toggleDraftProduct(draft, id, 0)
    expect(commerceProductCount(draft)).toBe(COMMERCE_LIMITS.products)
    toggleDraftProduct(draft, 'wv-1', 0)
    expect(pickedIds(draft)).not.toContain('wv-1')
    toggleDraftProduct(draft, 'wv-1', 0)
    expect(pickedIds(draft).filter(id => id === 'wv-1')).toHaveLength(1)
  })

  it('removes a product from whichever section holds it, and never leaves a draft without a section', () => {
    const draft = list({ sections: [{ title: 'أ', ids: ['wv-1'] }, { title: 'ب', ids: ['wv-2'] }] })
    toggleDraftProduct(draft, 'wv-2', 0)
    expect(draft.sections.map(section => section.ids)).toEqual([['wv-1'], []])
    removeDraftSection(draft, 1)
    expect(draft.sections).toHaveLength(1)
    removeDraftSection(draft, 0)
    expect(draft.sections).toEqual([{ title: 'أ', ids: [] }])
  })

  it('builds a single product and a catalog message', () => {
    const product = { ...emptyCommerceDraft(), type: 'product' as const, productId: 'wv-3' }
    expect(buildCommerceContent(product)).toEqual({ type: 'product', body: null, footer: null, product_retailer_id: 'wv-3' })
    toggleDraftProduct(product, 'wv-3', 0)
    expect(commerceProblem(product)).toBe('productRequired')
    const catalog = { ...emptyCommerceDraft(), type: 'catalog_message' as const, body: 'تصفح كتالوجنا' }
    expect(buildCommerceContent(catalog)).toEqual({ type: 'catalog_message', body: 'تصفح كتالوجنا', footer: null, thumbnail_product_retailer_id: null })
    toggleDraftProduct(catalog, 'wv-9', 0)
    expect(buildCommerceContent(catalog)).toMatchObject({ thumbnail_product_retailer_id: 'wv-9' })
    catalog.body = ''
    expect(commerceProblem(catalog)).toBe('bodyRequired')
  })

  it('round-trips stored content and reads a stored draft defensively', () => {
    const content = { type: 'product_list' as const, header: 'ع', body: 'ب', footer: 'ت', sections: [{ title: 'أ', product_retailer_ids: ['wv-1'] }] }
    expect(buildCommerceContent(commerceToDraft(content))).toEqual(content)
    expect(normalizeCommerceDraft({ type: 'nope' })).toBeNull()
    expect(normalizeCommerceDraft({ type: 'product', productId: 7, sections: 'x' })).toMatchObject({ type: 'product', productId: null, sections: [{ title: '', ids: [] }] })
  })
})

describe('carts and orders', () => {
  const product = { catalog_item_id: 1, name: 'قهوة', price: 50, currency: 'SAR', availability: 'in_stock' as const, image_url: null }
  const block: Extract<InboxMessageCommerce, { type: 'order' }> = {
    type: 'order', catalog_id: '123456', text: null, order: null,
    lines: [
      { product_retailer_id: 'wv-1', product, quantity: 2, item_price: 45, currency: 'SAR' },
      { product_retailer_id: 'x-9', product: null, quantity: 1, item_price: 10, currency: 'SAR' },
    ],
  }

  it('reads the thread cart into rows that flag an unknown product and a moved price', () => {
    const rows = cartLineRows(block)
    expect(rows.map(row => row.unknown)).toEqual([false, true])
    expect(rows[0]).toMatchObject({ unitPrice: 50, cartPrice: 45 })
    expect(rowsTotal(rows)).toEqual({ total: 110, complete: true })
  })

  it('totals in cents and reports a line without a price', () => {
    expect(linesTotal([{ quantity: 3, price: 0.1 }, { quantity: 1, price: 0.2 }])).toEqual({ total: 0.5, complete: true })
    expect(linesTotal([{ quantity: 1, price: null }])).toEqual({ total: 0, complete: false })
  })

  it('reads an order\'s lines', () => {
    const rows = orderLineRows({ lines: [{ id: 5, product_retailer_id: 'wv-1', catalog_item_id: null, name: null, quantity: 1, cart_price: 10, unit_price: null, currency: 'SAR', availability: null }] })
    expect(rows[0]).toMatchObject({ key: 5, name: 'wv-1', unknown: true })
  })

  it('shows the payment once an order exists, else its state', () => {
    expect(orderBadge({ state: 'cart', payment_status: null })).toEqual({ tone: 'info', labelKey: 'inbox.orders.state.cart' })
    expect(orderBadge({ state: 'ordered', payment_status: 'paid' })).toEqual({ tone: 'success', labelKey: 'inbox.orders.payment.paid' })
    expect(orderBadge({ state: 'ordered', payment_status: 'cancelled' }).tone).toBe('destructive')
    expect(orderBadge({ state: 'dismissed', payment_status: null }).tone).toBe('neutral')
  })

  it('counts the minutes to expiry and reports an expired one', () => {
    const now = Date.parse('2026-10-29T10:00:00Z')
    expect(expiryCountdown(null, now)).toBeNull()
    expect(expiryCountdown('2026-10-29T10:30:01Z', now)).toEqual({ expired: false, minutes: 31 })
    expect(expiryCountdown('2026-10-29T09:59:59Z', now)).toEqual({ expired: true, minutes: 0 })
  })

  it('formats money and survives an unknown currency code', () => {
    expect(formatInboxMoney(115, 'SAR', 'en')).toContain('115')
    expect(formatInboxMoney(5, 'ZZ', 'en')).toBe('5 ZZ')
  })
})

describe('product images', () => {
  it('accepts JPEG and PNG of at least 500 by 500 and 5 MB at most', () => {
    expect(imageProblem({ type: 'image/png', size: 1000 }, { width: 500, height: 500 })).toBeNull()
    expect(imageProblem({ type: 'image/gif', size: 1000 }, null)).toBe('type')
    expect(imageProblem({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }, null)).toBe('tooLarge')
    expect(imageProblem({ type: 'image/jpeg', size: 1000 }, { width: 499, height: 800 })).toBe('tooSmall')
  })
})
