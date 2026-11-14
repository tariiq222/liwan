import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ProductDetails from '../../app/components/products/ProductDetails.vue'
import { storyContext } from '../support/context'
import { products, untaxedProduct } from './productFixtures'

const meta = {
  title: 'Products/ProductDetails',
  component: ProductDetails,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/products/[id].vue:96', 'جانب سجل المنتج: النوع والوصف وهل له صورة والجهة التي تُدار منها، ثم سعر الوحدة: كما كُتب وقبل الضريبة والضريبة والإجمالي والعملة والضرائب. الخادم لا يعيد ملف الصورة، فلا معاينة لها.'),
  },
  args: { product: products[0] },
} satisfies Meta<typeof ProductDetails>
export default meta
type Story = StoryObj<typeof meta>

export const Shared: Story = { name: 'منتج مشترك له صورة' }
export const SeveralTaxes: Story = { name: 'أكثر من ضريبة', args: { product: products[1] } }
export const Branch: Story = { name: 'منتج فرع بلا صورة', args: { product: products[2] } }
export const WithoutTaxes: Story = { name: 'منشأة غير مسجّلة بالضريبة', args: { product: untaxedProduct } }
