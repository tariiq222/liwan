import type { Meta, StoryObj } from '@storybook/vue3-vite'
import MetricTile from '../../app/components/shared/MetricTile.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/MetricTile',
  component: MetricTile,
  parameters: storyContext('apps/web/app/components/project/finance/FinanceSummaryCards.vue:35', 'مؤشر واحد: تسمية ورقم وسطر مساند اختياري، وخانة لشريط تقدم أو شارة.'),
  args: { label: 'المخطط', value: '1000.00 ر.س', icon: 'i-lucide-wallet', hint: '1 بند ميزانية', valueDir: 'ltr' },
  render: args => ({
    components: { MetricTile },
    setup: () => ({ args }),
    template: '<div class="grid max-w-4xl gap-3 sm:grid-cols-3"><MetricTile v-bind="args" /><MetricTile label="نسبة الإنجاز" :value="40" unit="%" icon="i-lucide-list-checks" hint="1 من 3 مكتملة"><UProgress :model-value="40" size="sm" /></MetricTile><MetricTile label="المتبقي" :value="null" icon="i-lucide-scale" hint="الميزانية غير معروفة" /></div>',
  }),
} satisfies Meta<typeof MetricTile>
export default meta
type Story = StoryObj<typeof meta>

export const Row: Story = { name: 'صف مؤشرات' }
