import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RecordHero from '@liwan/ui/app/components/shared/layout/RecordHero.vue'
import MetricTile from '@liwan/ui/app/components/shared/data/MetricTile.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/RecordHero',
  component: RecordHero,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext(
      'apps/web/app/pages/meetings/[id].vue:202',
      'بطاقة هوية السجل أعلى التبويبات: سطر الهوية، سطر التفاصيل الخافت، إجراء اختياري في الطرف، وبطاقات مؤشرات مدمجة بجانبها.',
    ),
  },
  args: { icon: 'i-lucide-calendar-clock', tone: 'info' },
  render: args => ({
    components: { RecordHero, MetricTile },
    setup: () => ({ args }),
    template: `<div class="max-w-5xl">
      <RecordHero v-bind="args">
        <template #title>
          <span>الأحد، ١٨ أكتوبر ٢٠٢٦</span>
          <span dir="ltr" class="whitespace-nowrap text-base font-semibold text-muted tabular-nums">10:00 – 11:30</span>
        </template>
        <template #actions>
          <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-video" class="shrink-0 bg-default" label="رابط الاجتماع" />
        </template>
        <template #meta>
          <span class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-user" class="size-4 shrink-0" aria-hidden="true" />المنظّم: سارة القحطاني</span>
          <span class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-map-pin" class="size-4 shrink-0" aria-hidden="true" />قاعة الاجتماعات الرئيسية</span>
        </template>
        <MetricTile density="compact" icon="i-lucide-users" label="الحضور" :value="8" />
        <MetricTile density="compact" icon="i-lucide-list-checks" tone="warning" label="التوصيات المفتوحة" :value="3" hint="من أصل ٧ توصيات" />
      </RecordHero>
    </div>`,
  }),
} satisfies Meta<typeof RecordHero>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'مع بطاقات مؤشرات' }

export const Neutral: Story = {
  name: 'محايد (سجل ملغى)',
  args: { icon: 'i-lucide-calendar-clock', tone: 'neutral' },
  render: args => ({
    components: { RecordHero },
    setup: () => ({ args }),
    template: `<div class="max-w-5xl">
      <RecordHero v-bind="args">
        <template #title>
          <span>الثلاثاء، ٢٠ أكتوبر ٢٠٢٦</span>
          <span dir="ltr" class="whitespace-nowrap text-base font-semibold text-muted tabular-nums">14:00 – 15:00</span>
        </template>
        <template #meta>
          <span class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-user" class="size-4 shrink-0" aria-hidden="true" />المنظّم: خالد العتيبي</span>
          <span class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-map-pin" class="size-4 shrink-0" aria-hidden="true" />عن بُعد</span>
        </template>
      </RecordHero>
    </div>`,
  }),
}

export const WithoutTiles: Story = {
  name: 'دون بطاقات مؤشرات',
  args: { icon: 'i-lucide-calendar-clock', tone: 'info' },
  render: args => ({
    components: { RecordHero },
    setup: () => ({ args }),
    template: `<div class="max-w-5xl">
      <RecordHero v-bind="args">
        <template #title>
          <span>الأربعاء، ٢١ أكتوبر ٢٠٢٦</span>
          <span dir="ltr" class="whitespace-nowrap text-base font-semibold text-muted tabular-nums">09:30 – 10:30</span>
        </template>
        <template #actions>
          <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-video" class="shrink-0 bg-default" label="رابط الاجتماع" />
        </template>
        <template #meta>
          <span class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-user" class="size-4 shrink-0" aria-hidden="true" />المنظّم: نورة الدوسري</span>
        </template>
      </RecordHero>
    </div>`,
  }),
}
