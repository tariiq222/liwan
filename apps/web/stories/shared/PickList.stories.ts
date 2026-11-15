import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import PickList from '../../app/components/shared/form/PickList.vue'
import { storyContext } from '../support/context'

const rows = [{ id: 1, name: 'شاي أخضر' }, { id: 2, name: 'قهوة عربية' }, { id: 3, name: 'عسل سدر' }]

const meta = {
  title: 'Shared/PickList',
  component: PickList,
  parameters: storyContext('apps/web/app/components/shared/form/ProductPicker.vue:30', 'قاعدة منتقيات اختيار سجل واحد بالاسم: صندوق بحث وقائمة صفوف قابلة للنقر وحالات التحميل والخطأ والفراغ. صاحب البيانات يمرّر الصفوف ويرسم الصف في الفتحة `row`، ويربط الرابط الاختياري لإنشاء سجل عند الفراغ.'),
  args: {
    modelValue: null,
    items: rows,
    testId: 'pick-list',
    searchLabel: 'ابحث بالاسم',
    listLabel: 'السجلات',
    emptyText: 'لا سجلات بعد.',
  },
  render: args => ({
    components: { PickList },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: '<div class="max-w-sm"><PickList v-bind="args" v-model="value"><template #row="{ item }"><span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">{{ item.name }}</span></template></PickList></div>',
  }),
} satisfies Meta<typeof PickList>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'اختيار من قائمة' }
export const Selected: Story = { name: 'صف مختار', args: { modelValue: 2 } }
export const Loading: Story = { name: 'جارٍ التحميل', args: { loading: true, items: [] } }
export const Failed: Story = { name: 'فشل التحميل', args: { error: new Error('failed'), items: [] } }
export const Empty: Story = { name: 'لا سجلات', args: { items: [] } }
export const EmptyWithCreateLink: Story = { name: 'لا سجلات مع رابط إنشاء', args: { items: [], createTo: '/products/new', createLabel: 'أضف منتجًا' } }
export const Disabled: Story = { name: 'معطّل', args: { disabled: true } }
