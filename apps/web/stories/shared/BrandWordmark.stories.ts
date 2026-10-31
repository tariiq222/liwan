import type { Meta, StoryObj } from '@storybook/vue3-vite'
import BrandWordmark from '@liwan/ui/app/components/shared/layout/BrandWordmark.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/BrandWordmark',
  component: BrandWordmark,
} satisfies Meta<typeof BrandWordmark>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: storyContext('unused', 'شعار LiwanOS المعتمد: علامة النجمة والمعين بلون ليوان مع «نظام ليوان»؛ بالسُّمك الأثقل لأنها دون 24px.'),
  args: { size: 'md' },
}

export const OnRail: Story = {
  parameters: storyContext('unused', 'الشعار الأبيض فوق سطح لافندر، كما في صفحة الدخول؛ الحجم الكبير بالسُّمك العادي.'),
  args: { size: 'lg', inverted: true },
  render: args => ({
    components: { BrandWordmark },
    setup: () => ({ args }),
    template: '<div class="bg-(--primary-solid) p-4"><BrandWordmark v-bind="args" /></div>',
  }),
}

export const MarkOnRail: Story = {
  parameters: storyContext('unused', 'العلامة وحدها بلا الاسم، في أسفل الشريط الجانبي تحت الإعدادات.'),
  args: { size: 'md', inverted: true, markOnly: true },
  render: args => ({
    components: { BrandWordmark },
    setup: () => ({ args }),
    template: '<div class="bg-(--primary-solid) p-4"><BrandWordmark v-bind="args" /></div>',
  }),
}
