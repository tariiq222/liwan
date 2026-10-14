import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TimelineFrame from '../../app/components/shared/TimelineFrame.vue'
import { storyContext } from '../support/context'

// A fixed "today" keeps the range label, and so the screenshots, stable.
const TODAY = new Date(2026, 9, 5)
const DAY = 24 * 60 * 60 * 1000

const meta = {
  title: 'Shared/TimelineFrame',
  component: TimelineFrame,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('unused', 'قالب الخط الزمني للتقويم والجدول: السابق / الفترة / اليوم / التالي، ومقياس عرض اختياري. الصفحة تملك الفترة والمقياس، والإطار يرسل الأحداث فقط. السهمان ينعكسان في العربية.'),
  },
  args: { title: '', rangeLabel: '' },
} satisfies Meta<typeof TimelineFrame>
export default meta
type Story = StoryObj<typeof meta>

export const Calendar: Story = {
  name: 'تقويم شهري',
  render: () => ({
    components: { TimelineFrame },
    setup() {
      const { t, locale } = useI18n()
      const cursor = ref(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1))
      const rangeLabel = computed(() => new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric', calendar: 'gregory' }).format(cursor.value))
      const shift = (delta: number) => { cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + delta, 1) }
      const today = () => { cursor.value = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1) }
      return { t, rangeLabel, shift, today }
    },
    template: `<main class="nasq-shell-main">
      <TimelineFrame :title="t('nav.meetingCalendar')" :range-label="rangeLabel" @prev="shift(-1)" @next="shift(1)" @today="today">
        <template #actions><UButton icon="i-lucide-plus" :label="t('meetingsUi.new')" /></template>
        <div class="rounded-lg bg-default p-6 text-sm text-muted ring ring-default">{{ t('meetingsUi.empty') }}</div>
      </TimelineFrame>
    </main>`,
  }),
}

export const Schedule: Story = {
  name: 'جدول بمقياس أسبوعي وشهري',
  render: () => ({
    components: { TimelineFrame },
    setup() {
      const { t, locale } = useI18n()
      const scale = ref('week')
      const start = ref(new Date(TODAY))
      const scales = computed(() => [{ value: 'week', label: t('projects.schedule.week') }, { value: 'month', label: t('projects.schedule.month') }])
      const rangeLabel = computed(() => scale.value === 'month'
        ? new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric', calendar: 'gregory' }).format(start.value)
        : new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', year: 'numeric', calendar: 'gregory' }).formatRange(start.value, new Date(start.value.getTime() + 6 * DAY)))
      const shift = (delta: number) => {
        const value = start.value
        start.value = scale.value === 'month' ? new Date(value.getFullYear(), value.getMonth() + delta, 1) : new Date(value.getTime() + delta * 7 * DAY)
      }
      return { t, scale, scales, rangeLabel, shift, today: () => { start.value = new Date(TODAY) } }
    },
    template: `<main class="nasq-shell-main">
      <TimelineFrame v-model:scale="scale" :title="t('projects.schedule.title')" :range-label="rangeLabel" :scales="scales" @prev="shift(-1)" @next="shift(1)" @today="today">
        <template #actions><UButton icon="i-lucide-plus" :label="t('tasks.new')" /></template>
        <div class="rounded-lg bg-default p-6 text-sm text-muted ring ring-default">{{ t('projects.schedule.empty') }}</div>
      </TimelineFrame>
    </main>`,
  }),
}
