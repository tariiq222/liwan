import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import FilterChoice from '@webvue/ui/app/components/shared/data/FilterChoice.vue'
import { storyContext } from '../support/context'

const items = [
  { value: '__all__', label: 'كل الحالات' },
  { value: 'draft', label: 'مسودة' },
  { value: 'confirmed', label: 'مؤكد' },
  { value: 'done', label: 'منتهٍ' },
]

const meta = {
  title: 'Shared/FilterChoice',
  component: FilterChoice,
  parameters: storyContext('apps/web/app/pages/projects/dashboard.vue:170', 'اختيار داخل نافذة الفلاتر: شرائح لاختيار واحد أو أكثر، أو شريط مقسّم لخيارات قليلة.'),
  args: { label: 'الحالة', items, modelValue: '__all__', layout: 'chips', disabled: false },
  render: args => ({
    components: { FilterChoice },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: '<div class="max-w-md rounded-card ring ring-default bg-default p-4"><FilterChoice v-bind="args" v-model="value" /></div>',
  }),
} satisfies Meta<typeof FilterChoice>
export default meta
type Story = StoryObj<typeof meta>

export const Chips: Story = { name: 'شرائح' }
export const Multiple: Story = { name: 'اختيار متعدد', args: { modelValue: ['draft', 'confirmed'], items: items.slice(1) } }
export const Segment: Story = { name: 'شريط مقسّم', args: { layout: 'segment', items: items.slice(0, 3) } }
export const Disabled: Story = { name: 'معطّل', args: { disabled: true } }
