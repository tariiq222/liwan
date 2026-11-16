import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { http, HttpResponse } from 'msw'
import { ProductPickListSchema } from '@liwan/contracts'
import InvoiceLineProduct from '../../app/components/finance/invoices/InvoiceLineProduct.vue'
import { meWith } from '../products/productFixtures'
import { storyContext } from '../support/context'

const currency = { id: 2, name: 'SAR', symbol: 'ر.س' }
const pick = (id: number, name: string, unit: number) => ({
  id, name, type: 'service', unit_price: unit, amount_untaxed: unit, amount_tax: unit * 0.15, amount_total: unit * 1.15, currency,
})
const picks = ProductPickListSchema.parse({ items: [pick(1, 'باقة أساسية', 120), pick(2, 'باقة متقدمة', 280)], total: 2 })
const serve = (body: unknown = picks) => ({ msw: { handlers: { api: [
  http.get('/api/v1/me', () => HttpResponse.json(meWith(['finance.invoices.manage']))),
  http.get('/api/v1/products/pick', () => HttpResponse.json(body)),
] } } })

const meta = {
  title: 'Finance/InvoiceLineProduct',
  component: InvoiceLineProduct,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/finance/invoices/InvoiceForm.vue:155', 'المنتج الاختياري لبند فاتورة العميل أو الإشعار الدائن. اختيار منتج يملأ الوصف والسعر ويبقى البند قابلًا للتعديل.'), ...serve() },
  args: { productId: null, productName: '' },
  render: args => ({
    components: { InvoiceLineProduct },
    setup: () => ({ args, productId: ref(args.productId) }),
    template: '<div class="max-w-md rounded-card bg-elevated p-3"><InvoiceLineProduct v-bind="args" v-model:product-id="productId" /></div>',
  }),
} satisfies Meta<typeof InvoiceLineProduct>
export default meta
type Story = StoryObj<typeof meta>

export const NoProduct: Story = { name: 'بند بلا منتج' }
export const Chosen: Story = { name: 'منتج مختار', args: { productId: 1, productName: 'باقة أساسية' } }
export const ArchivedProduct: Story = { name: 'منتج مؤرشف بقي على المسودة', args: { productId: 7, productName: 'باقة قديمة' } }
export const Disabled: Story = { name: 'معطّل أثناء الحفظ', args: { productId: 1, productName: 'باقة أساسية', disabled: true } }
export const NoProductsYet: Story = { name: 'لا منتجات في الشركة', parameters: serve({ items: [], total: 0 }) }
