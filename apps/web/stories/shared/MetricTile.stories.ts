import type { Meta, StoryObj } from '@storybook/vue3-vite'
import MetricTile from '@liwan/ui/app/components/shared/data/MetricTile.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/MetricTile',
  component: MetricTile,
  parameters: storyContext('apps/web/app/components/pmo/projects/finance/FinanceSummaryCards.vue:44', 'مؤشر واحد: تسمية ورقم وسطر مساند اختياري، وخانة لشريط تقدم أو شارة.'),
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
export const CompactStrip: Story = {
  name: 'شريط مدمج بنبرات (مؤشرات قائمة المهام)',
  render: () => ({
    components: { MetricTile },
    template: `<div class="grid max-w-5xl grid-cols-2 gap-(--liwan-gap-card) lg:grid-cols-4"><MetricTile density="compact" icon="i-lucide-list-checks" label="إجمالي المهام" :value="128" hint="22٪ منجزة" :progress="22" value-dir="ltr" /><MetricTile density="compact" tone="warning" icon="i-lucide-clock" label="المهام المفتوحة" :value="82" hint="64٪ من الإجمالي" :progress="64" value-dir="ltr" /><MetricTile density="compact" tone="danger" icon="i-lucide-circle-alert" label="المهام المتأخرة" :value="18" hint="14٪ من الإجمالي" :progress="14" value-dir="ltr" /><MetricTile density="compact" tone="success" icon="i-lucide-circle-check" label="المهام المنجزة" :value="28" hint="22٪ من الإجمالي" :progress="22" value-dir="ltr" /></div>`,
  }),
}

export const Emphasis: Story = {
  name: 'رقم بارز ورابط',
  parameters: storyContext('unused', '`emphasis`: رقم أكبر ورقاقة بصبغة الهوية للرقم الرئيسي في الصفحة؛ `to` يجعل البطاقة كلها رابطًا بحلقة تركيز.'),
  render: () => ({
    components: { MetricTile },
    template: `<div class="grid max-w-3xl gap-(--liwan-gap-card) sm:grid-cols-2"><MetricTile emphasis icon="i-lucide-folder-kanban" label="المشاريع النشطة" :value="12" value-dir="ltr" /><MetricTile emphasis to="/tasks" icon="i-lucide-circle-alert" tone="danger" label="مهام متأخرة" :value="18" hint="افتح القائمة" value-dir="ltr" /></div>`,
  }),
}
