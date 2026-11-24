import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import ProductForm from '../../app/components/products/ProductForm.vue'
import { storyContext } from '../support/context'
import { meWith, products, taxChoices, untaxedProduct } from './productFixtures'

const session = (capabilities: string[], branch?: { id: number; name: string }) => http.get('/api/v1/me', () => HttpResponse.json(meWith(capabilities, branch)))
const both = ['products.read', 'products.manage', 'products.prices.manage']
const taxes = http.get('/api/v1/products/taxes', () => HttpResponse.json({ items: taxChoices, total: taxChoices.length }))
const noTaxes = http.get('/api/v1/products/taxes', () => HttpResponse.json({ items: [], total: 0 }))
const handlers = (...extra: ReturnType<typeof http.get>[]) => ({ msw: { handlers: { api: [session(both), taxes, ...extra] } } })
const refuse = (status: number, body: object) => ({ msw: { handlers: { api: [session(both), taxes, http.patch('/api/v1/products/1', () => HttpResponse.json(body, { status }))] } } })

const meta = {
  title: 'Products/ProductForm',
  component: ProductForm,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/products/new.vue:20', 'نموذج إنشاء المنتج وتعديله: الاسم والنوع والسعر والضريبة والوصف والصورة. السعر والتعريف صلاحيتان منفصلتان، ومن يملك السعر وحده يغيّر السعر فقط. المنتج الذي يُدار من شركة أخرى يظهر للعرض مع السبب.'),
    ...handlers(),
  },
  args: { backTo: '/products' },
} satisfies Meta<typeof ProductForm>
export default meta
type Story = StoryObj<typeof meta>

export const New: Story = { name: 'منتج جديد (مسجّل بالضريبة)' }
export const NewWithoutPriceRight: Story = { name: 'منتج جديد بلا صلاحية السعر', parameters: { msw: { handlers: { api: [session(['products.read', 'products.manage']), taxes] } } } }
export const NewWithoutTaxes: Story = { name: 'منتج جديد (منشأة غير مسجّلة بالضريبة)', parameters: handlers(noTaxes) }
export const Edit: Story = { name: 'تعديل', args: { product: products[0] } }
export const EditSeveralTaxes: Story = { name: 'تعديل منتج بأكثر من ضريبة', args: { product: products[1] } }
export const EditWithoutTaxes: Story = { name: 'تعديل (بلا ضريبة في المنشأة)', args: { product: untaxedProduct } }
export const EditPriceOnly: Story = { name: 'تعديل السعر فقط', args: { product: products[0] }, parameters: { msw: { handlers: { api: [session(['products.read', 'products.prices.manage'])] } } } }
export const EditWithoutPriceRight: Story = { name: 'تعديل بلا صلاحية السعر', args: { product: products[0] }, parameters: { msw: { handlers: { api: [session(['products.read', 'products.manage']), taxes] } } } }
export const ManagedInBranch: Story = { name: 'يُدار من فرع آخر', args: { product: products[2] } }
export const ManagedInRootCompany: Story = {
  name: 'يُدار من الشركة الرئيسية (جلسة فرع)',
  args: { product: products[0] },
  parameters: { msw: { handlers: { api: [session(both, { id: 2, name: 'فرع جدة' }), taxes] } } },
}
export const PriceRefused: Story = { name: 'سعر غير صالح', args: { product: products[0] }, parameters: refuse(422, { code: 'invalid', message: 'invalid price', field: 'list_price' }) }
export const ManagedRefusedOnSave: Story = {
  name: 'رفض الخادم: يُدار من الشركة الرئيسية',
  args: { product: products[0] },
  parameters: refuse(403, { code: 'forbidden', message: 'managed in the root company', details: { reason: 'managed_in_root_company' } }),
}
