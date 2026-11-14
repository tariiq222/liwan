import { MeSchema, type Product, type ProductSettings, type ProductTaxChoice } from '@liwan/contracts'
import { me } from '../fixtures/pmo'

// The wire shapes the products stories share. The mock establishment is registered for VAT, 15% added on top of the price
// as typed; the working company is the root company (id 1).
const currency = { id: 2, name: 'SAR', symbol: 'ر.س' }
export const vat = { id: 11, name: 'ضريبة القيمة المضافة', amount: 15 }
export const zeroRated = { id: 12, name: 'نسبة صفر', amount: 0 }

const product = (id: number, fields: Pick<Product, 'name' | 'type' | 'list_price'> & Partial<Product>): Product => ({
  id, description: null, has_image: true, company: null, active: true, taxes: [vat], ...fields,
  price: { unit_price: fields.list_price, amount_untaxed: fields.list_price, amount_tax: Math.round(fields.list_price * 15) / 100, amount_total: Math.round(fields.list_price * 115) / 100, currency },
})

export const products: Product[] = [
  product(1, { name: 'باقة أساسية', type: 'service', list_price: 120, description: 'اشتراك شهري للفرق الصغيرة' }),
  product(2, { name: 'عسل سدر', type: 'goods', list_price: 160, taxes: [vat, zeroRated] }),
  product(3, { name: 'ميزان مطبخ', type: 'goods', list_price: 75, has_image: false, company: { id: 2, name: 'فرع جدة' } }),
]
export const archivedProduct = product(4, { name: 'باقة قديمة', type: 'service', list_price: 90, has_image: false, active: false })
/** A product of an establishment that is not registered for VAT: no `taxes` key, no tax in the price. */
export const untaxedProduct: Product = (({ taxes: _taxes, ...rest }) => ({ ...rest, price: { ...rest.price, amount_tax: 0, amount_total: rest.list_price } }))(products[0]!)

export const settings: ProductSettings = { sharing: 'establishment', can_manage: true, revision: 3 }

export const taxChoices: ProductTaxChoice[] = [
  { ...vat, active: true },
  { ...zeroRated, active: true },
  { id: 13, name: 'معفى', amount: 0, active: false },
]

/** The session of a story: the root company, or a branch session when `branch` is given. */
export const meWith = (capabilities: string[], branch?: { id: number; name: string }) => MeSchema.parse({
  ...me,
  capabilities,
  home_capabilities: capabilities,
  ...(branch ? { company: branch, companies: [{ id: 1, name: 'ليوان' }, branch], is_root_company: false } : {}),
})
