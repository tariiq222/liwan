import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ProductTable from '../../app/components/products/ProductTable.vue'
import { storyContext } from '../support/context'
import { products } from './productFixtures'

const meta = {
  title: 'Products/ProductTable',
  component: ProductTable,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/products/ProductDirectory.vue:69', 'صفوف قائمة المنتجات: الاسم والنوع والسعر كما كُتب والإجمالي شامل الضريبة والجهة التي تُدار منها (أو «مشترك بين الفروع»). الصفحة تملك الاستعلام والترقيم.'),
  },
  args: { rows: products, loading: false, error: null, recordTo: product => `/products/${product.id}` },
} satisfies Meta<typeof ProductTable>
export default meta
type Story = StoryObj<typeof meta>

export const Rows: Story = { name: 'صفوف' }
export const Loading: Story = { name: 'جارٍ التحميل', args: { rows: [], loading: true } }
export const Failed: Story = { name: 'فشل التحميل', args: { rows: [], error: new Error('offline') } }
