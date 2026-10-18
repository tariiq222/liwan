import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import SegmentedControl from '@webvue/ui/app/components/shared/data/SegmentedControl.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/SegmentedControl',
  component: SegmentedControl,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/pmo/tasks/TaskToolbar.vue:209', 'المجموعة المستديرة الواحدة للنطاقات والأنواع والتجميع والمقاييس: حاوية بحلقة وحبّات، المختارة `soft` وبقيتها `ghost`. تعمل بـ v-model، وتنتظر التهيئة، وتصلح بأيقونات فقط (مبدّل العرض) أو بملء الصف.') },
  args: { label: 'النطاق', modelValue: 'open', items: [{ value: 'open', label: 'مفتوحة' }, { value: 'closed', label: 'مغلقة' }] },
  render: args => ({
    components: { SegmentedControl },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: '<SegmentedControl v-bind="args" v-model="value" />',
  }),
} satisfies Meta<typeof SegmentedControl>
export default meta
type Story = StoryObj<typeof meta>

export const Scope: Story = { name: 'نطاق (مفتوحة ومغلقة)' }
export const ThreeOptions: Story = {
  name: 'ثلاثة خيارات',
  args: { label: 'النوع', modelValue: 'all', items: [{ value: 'all', label: 'الكل' }, { value: 'expense', label: 'مصروفات' }, { value: 'income', label: 'إيرادات' }] },
}
export const IconOnly: Story = {
  name: 'أيقونات فقط',
  args: { label: 'طريقة العرض', modelValue: 'table', iconOnly: true, items: [{ value: 'table', label: 'عرض الجدول', icon: 'i-lucide-list' }, { value: 'board', label: 'عرض اللوحة', icon: 'i-lucide-layout-grid' }] },
}
export const Block: Story = { name: 'بملء الصف', args: { block: true }, render: args => ({ components: { SegmentedControl }, setup: () => ({ args, value: ref(args.modelValue) }), template: '<div class="max-w-xs"><SegmentedControl v-bind="args" v-model="value" /></div>' }) }
export const Disabled: Story = { name: 'معطّلة', args: { disabled: true } }
export const Actions: Story = {
  name: 'إجراءات (أزرار وروابط)',
  args: { mode: 'actions', iconOnly: true, label: 'إجراءات القسم', items: [{ value: 'edit', label: 'تعديل', icon: 'i-lucide-pencil' }, { value: 'add', label: 'إضافة فرع', icon: 'i-lucide-plus' }, { value: 'people', label: 'الموظفون', icon: 'i-lucide-users', to: '/hr' }] },
}
