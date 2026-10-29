import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { InboxCatalogPickItem } from '@webvue/contracts'
import InboxProductPicker from '../../app/components/inbox/InboxProductPicker.vue'
import { storyContext } from '../support/context'

const pick = (id: number, name: string, extra: Partial<InboxCatalogPickItem> = {}): InboxCatalogPickItem => ({
  id, product_retailer_id: `wv-${100 + id}`, name, price: 10 * id, currency: 'SAR', availability: 'in_stock', image_url: null, ...extra,
})
const items = [pick(1, 'قهوة مختصة 250 غ'), pick(2, 'دلة سفر معدنية'), pick(3, 'كوب سيراميك'), pick(4, 'مطحنة يدوية', { availability: 'out_of_stock' }), pick(5, 'فلاتر ورقية')]

const meta = {
  title: 'Inbox/InboxProductPicker',
  component: InboxProductPicker,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/inbox/InboxCommerceContentEditor.vue:77', 'قائمة منتجات الكتالوج مع بحث وعدّاد الحد الأقصى: ضغطة تختار المنتج وأخرى تلغيه، ويُقفل غير المختار عند بلوغ الحد.'),
  },
  args: { items, picked: ['wv-102'], max: 30 },
} satisfies Meta<typeof InboxProductPicker>
export default meta
type Story = StoryObj<typeof meta>

export const Defaults: Story = {}
export const NothingPicked: Story = { args: { picked: [] } }
export const LimitReached: Story = { args: { picked: ['wv-101'], max: 1 } }
export const SingleProduct: Story = { args: { picked: [], max: 1 } }
export const Loading: Story = { args: { items: [], loading: true } }
export const Empty: Story = { args: { items: [] } }
export const Failed: Story = { args: { items: [], error: new Error('تعذّر تحميل المنتجات') } }
