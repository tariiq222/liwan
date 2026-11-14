import type { ProductPick } from '@liwan/contracts'

const currency = { id: 2, name: 'SAR', symbol: 'ر.س' }
const pick = (id: number, name: string, type: ProductPick['type'], unit: number): ProductPick => ({
  id, name, type, unit_price: unit, amount_untaxed: unit, amount_tax: Math.round(unit * 15) / 100, amount_total: Math.round(unit * 115) / 100, currency,
})

/** What `GET /api/v1/products/pick` answers in Storybook: a service plan, a service and two goods, 15% VAT on top. */
export const productPicks: ProductPick[] = [
  pick(1, 'باقة أساسية', 'service', 120),
  pick(2, 'باقة متقدمة', 'service', 280),
  pick(3, 'استشارة ساعة', 'service', 450),
  pick(4, 'عسل سدر', 'goods', 160),
]
