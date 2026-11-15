import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesQuoteHeader from '../../app/components/sales/SalesQuoteHeader.vue'
import { storyContext } from '../support/context'

const branding = http.get('/api/v1/branding', () => HttpResponse.json({ name: 'مؤسسة ليوان', logo_url: null }))
const meta = {
  title: 'Sales/SalesQuoteHeader',
  component: SalesQuoteHeader,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/quote/[id].vue:44', 'رأس صفحة عرض السعر العامة: شعار المنشأة واسمها فوق عنوان عرض السعر.'), msw: { handlers: { api: [branding] } } },
  args: { title: 'عرض سعر S00005', company: 'مؤسسة ليوان' },
} satisfies Meta<typeof SalesQuoteHeader>
export default meta
type Story = StoryObj<typeof meta>

export const Company: Story = { name: 'باسم المنشأة' }
export const BeforeTheQuotationLoads: Story = { name: 'قبل تحميل العرض', args: { title: 'عرض سعر', company: null } }
