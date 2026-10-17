import type { Meta, StoryObj } from '@storybook/vue3-vite'
import BrandWordmark from '@webvue/ui/app/components/shared/layout/BrandWordmark.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/BrandWordmark',
  component: BrandWordmark,
} satisfies Meta<typeof BrandWordmark>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: storyContext('unused', 'شعار ويب فيو المعتمد: العلامة بلون العميل مع الاسم؛ يُستخدم في الشريط الجانبي وصفحة الدخول.'),
  args: { size: 'md' },
}

export const OnRail: Story = {
  parameters: storyContext('unused', 'يعرض الشعار الأبيض فوق خلفية الشريط الجانبي الداكنة.'),
  args: { size: 'lg', inverted: true },
  render: args => ({
    components: { BrandWordmark },
    setup: () => ({ args }),
    template: '<div class="bg-webvue-rail p-4"><BrandWordmark v-bind="args" /></div>',
  }),
}
