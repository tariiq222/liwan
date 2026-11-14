// Part of the isolated UI mock stack: the products of the tenant as the products service lists them for a holder of a
// pick capability (GET /api/v1/products/pick, shaped like packages/contracts/src/products). The applications' mocks
// (CRM packages, the Meta catalog) pick from this one list, so a product added in one is found by the other. A product
// carries 15% VAT on top of its unit price, like the mock establishment's tax.
const VAT = 0.15
const round2 = value => Math.round(value * 100) / 100
const CURRENCY = { id: 2, name: 'SAR', symbol: 'ر.س' }

export const PRODUCT_PICK_PATH = '/api/v1/products/pick'

// id -> the product template: its name, type and the unit price as typed on it.
export const MOCK_PRODUCTS = [
  { id: 1, name: 'باقة أساسية', type: 'service', unit_price: 120 },
  { id: 2, name: 'باقة متقدمة', type: 'service', unit_price: 280 },
  { id: 3, name: 'باقة الأعمال', type: 'service', unit_price: 450 },
  { id: 201, name: 'شاي أخضر', type: 'goods', unit_price: 22 },
  { id: 202, name: 'عسل سدر', type: 'goods', unit_price: 160 },
  { id: 203, name: 'ميزان مطبخ', type: 'goods', unit_price: 75 },
  { id: 204, name: 'منتج بلا صورة', type: 'goods', unit_price: 10 },
]

export const findMockProduct = id => MOCK_PRODUCTS.find(product => product.id === id)

const pickOf = product => ({
  id: product.id,
  name: product.name,
  type: product.type,
  unit_price: product.unit_price,
  amount_untaxed: product.unit_price,
  amount_tax: round2(product.unit_price * VAT),
  amount_total: round2(product.unit_price * (1 + VAT)),
  currency: CURRENCY,
})

/** One page of the pick list: `q` filters by name, `limit` and `offset` page it. */
export function productPickPage(url) {
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50)
  const matches = MOCK_PRODUCTS.filter(product => !q || product.name.toLowerCase().includes(q))
  return { items: matches.slice(offset, offset + limit).map(pickOf), total: matches.length }
}
