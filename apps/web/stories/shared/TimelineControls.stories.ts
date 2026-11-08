import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TimelineControls from '@liwan/ui/app/components/shared/layout/TimelineControls.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/TimelineControls',
  component: TimelineControls,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/pages/projects/[id]/tasks.vue:155', 'أزرار الخط الزمني: السابق / الفترة / اليوم / التالي ومقياس عرض اختياري. يرسمها إطار الخط الزمني في ترويسة بطاقته، وتضعها قائمة المهام في صف أدواتها حين يكون عرض الجدول الزمني. السهمان ينعكسان في العربية.'),
  },
  args: { rangeLabel: '' },
} satisfies Meta<typeof TimelineControls>
export default meta
type Story = StoryObj<typeof meta>

export const WithScale: Story = {
  name: 'بمقياس أسبوعي وشهري',
  render: () => ({
    components: { TimelineControls },
    setup() {
      const { t } = useI18n()
      const scale = ref('week')
      const scales = [{ value: 'week', label: t('projects.schedule.week') }, { value: 'month', label: t('projects.schedule.month') }]
      return { scale, scales }
    },
    template: '<TimelineControls range-label="2026-10-05 – 2026-10-11" :scale="scale" :scales="scales" @update:scale="scale = $event" />',
  }),
}
