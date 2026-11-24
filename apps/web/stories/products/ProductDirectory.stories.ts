import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import ProductDirectory from '../../app/components/products/ProductDirectory.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { storyContext } from '../support/context'
import { meWith } from './productFixtures'

const reader = http.get('/api/v1/me', () => HttpResponse.json(meWith(['products.read'])))
const empty = http.get('/api/v1/products', () => HttpResponse.json({ items: [], total: 0 }))
const at = (path: string) => async () => { await __getRouter()!.replace(path); return {} }

const meta = {
  title: 'Products/ProductDirectory',
  component: ProductDirectory,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/products/index.vue:17', 'بطاقة المنتجات: البحث بالاسم، فلتر النوع، تبديل النشط والمؤرشف، والصفحة، وكلها في عنوان الصفحة. حالات الفراغ والتحميل والخطأ من المكوّنات المشتركة.'),
    msw: { handlers: { api: [reader] } },
  },
} satisfies Meta<typeof ProductDirectory>
export default meta
type Story = StoryObj<typeof meta>

export const Rows: Story = { name: 'منتجات', loaders: [at('/products')] }
export const Filtered: Story = { name: 'نوع محدد', loaders: [at('/products?type=goods')] }
export const Archived: Story = { name: 'المؤرشفة', loaders: [at('/products?archived=1')] }
export const Empty: Story = { name: 'لا منتجات', loaders: [at('/products')], parameters: { msw: { handlers: { api: [reader, empty] } } } }
export const NoResults: Story = { name: 'لا نتائج للبحث', loaders: [at('/products?q=زيت')], parameters: { msw: { handlers: { api: [reader, empty] } } } }
export const Failed: Story = { name: 'فشل التحميل', loaders: [at('/products')], parameters: { msw: { handlers: { api: [reader, http.get('/api/v1/products', () => HttpResponse.json({ code: 'unavailable', message: 'down' }, { status: 503 }))] } } } }
