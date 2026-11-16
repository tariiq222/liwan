import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesOrderDirectory from '../../app/components/sales/SalesOrderDirectory.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { storyContext } from '../support/context'
import { meWith } from './salesFixtures'

const reader = http.get('/api/v1/me', () => HttpResponse.json(meWith(['sales.read'])))
const empty = http.get('/api/v1/sales/orders', () => HttpResponse.json({ items: [], total: 0 }))
const at = (path: string) => async () => { await __getRouter()!.replace(path); return {} }

const meta = {
  title: 'Sales/SalesOrderDirectory',
  component: SalesOrderDirectory,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/sales/index.vue:17', 'بطاقة المبيعات: البحث، المصدر، «مستنداتي فقط» والمرحلة والصفحة، وكلها في عنوان الصفحة.'),
    msw: { handlers: { api: [reader] } },
  },
} satisfies Meta<typeof SalesOrderDirectory>
export default meta
type Story = StoryObj<typeof meta>

export const Rows: Story = { name: 'مستندات', loaders: [at('/sales')] }
export const Quotations: Story = { name: 'عروض الأسعار', loaders: [at('/sales?state=quotations')] }
export const Empty: Story = { name: 'لا مستندات', loaders: [at('/sales')], parameters: { msw: { handlers: { api: [reader, empty] } } } }
export const NoResults: Story = { name: 'لا نتائج للبحث', loaders: [at('/sales?q=x')], parameters: { msw: { handlers: { api: [reader, empty] } } } }
export const Failed: Story = { name: 'فشل التحميل', loaders: [at('/sales')], parameters: { msw: { handlers: { api: [reader, http.get('/api/v1/sales/orders', () => HttpResponse.json({ code: 'unavailable', message: 'down' }, { status: 503 }))] } } } }
export const Forbidden: Story = { name: 'بلا صلاحية', parameters: { msw: { handlers: { api: [http.get('/api/v1/me', () => HttpResponse.json(meWith([])))] } } } }
