import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { http, HttpResponse } from 'msw'
import ProductPicker from '../../app/components/shared/form/ProductPicker.vue'
import { storyContext } from '../support/context'
import { meWith } from '../products/productFixtures'

const meta = {
  title: 'Shared/ProductPicker',
  component: ProductPicker,
  parameters: storyContext('apps/web/app/components/crm/settings/CrmPackageListCard.vue:61', 'يبحث في /api/v1/products/pick ويعرض اسم المنتج وإجمالي سعر الوحدة. لا ينشئ منتجًا.'),
  args: { modelValue: null },
  render: args => ({
    components: { ProductPicker },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: '<div class="grid max-w-sm gap-1"><span class="text-sm font-medium text-highlighted">المنتج</span><ProductPicker v-bind="args" v-model="value" /></div>',
  }),
} satisfies Meta<typeof ProductPicker>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'اختيار منتج', parameters: storyContext('apps/web/app/components/inbox/InboxCatalogItemForm.vue:78') }
export const Selected: Story = { name: 'منتج مختار', args: { modelValue: 2 } }
export const Excluding: Story = { name: 'استثناء ما أُضيف', args: { exclude: [1, 2] } }
export const Disabled: Story = { name: 'معطّل', args: { disabled: true } }

const noProducts = (capabilities: string[]) => ({ msw: { handlers: { api: [
  http.get('/api/v1/me', () => HttpResponse.json(meWith(capabilities))),
  http.get('/api/v1/products/pick', () => HttpResponse.json({ items: [], total: 0 })),
] } } })
export const EmptyWithCreateLink: Story = { name: 'لا منتجات: رابط إنشاء منتج لمن يديرها', parameters: noProducts(['products.read', 'products.manage']) }
export const EmptyForViewer: Story = { name: 'لا منتجات: نص فقط لغير المدير', parameters: noProducts(['products.read']) }
