import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AiConfirmCard from '../../app/components/ai/AiConfirmCard.vue'
import AiDraftCard from '../../app/components/ai/AiDraftCard.vue'
import AiLimitNotice from '../../app/components/ai/AiLimitNotice.vue'
import AiRecordCards from '../../app/components/ai/AiRecordCards.vue'
import AiToolTrace from '../../app/components/ai/AiToolTrace.vue'
import { storyContext } from '../support/context'

const page = storyContext('apps/web/app/pages/ai/index.vue')

const meta = {
  title: 'Ai/Cards',
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...page },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const wrap = (components: Record<string, unknown>, template: string, setup?: () => Record<string, unknown>) => () => ({ components, setup: setup ?? (() => ({})), template: `<div class="mx-auto flex max-w-2xl flex-col gap-4">${template}</div>` })

export const ConfirmPending: Story = {
  name: 'تأكيد: بانتظار القرار',
  render: wrap({ AiConfirmCard }, '<AiConfirmCard summary="سأغيّر حالة المهمة «تقرير الربع» إلى منجزة" state="pending" />'),
}
export const ConfirmApproved: Story = {
  name: 'تأكيد: نُفّذ',
  render: wrap({ AiConfirmCard }, '<AiConfirmCard summary="سأغيّر حالة المهمة «تقرير الربع» إلى منجزة" state="approved" />'),
}
export const ConfirmRejected: Story = {
  name: 'تأكيد: أُلغي',
  render: wrap({ AiConfirmCard }, '<AiConfirmCard summary="سأغيّر حالة المهمة «تقرير الربع» إلى منجزة" state="rejected" />'),
}

export const ConfirmExecuting: Story = {
  name: 'تأكيد: يُنفَّذ من طلب سابق',
  render: wrap({ AiConfirmCard }, '<AiConfirmCard summary="سأغيّر حالة المهمة «تقرير الربع» إلى منجزة" state="pending" disabled note="بدأ تنفيذه من طلب سابق. حدّث الصفحة بعد قليل لتعرف نتيجته." />'),
}

export const DraftPending: Story = {
  name: 'مسودة: بانتظار المراجعة',
  render: wrap({ AiDraftCard }, '<AiDraftCard summary="مسودة مشروع «بوابة العملاء»" state="pending" />'),
}
export const DraftApproved: Story = {
  name: 'مسودة: أُرسلت',
  render: wrap({ AiDraftCard }, '<AiDraftCard summary="مسودة مشروع «بوابة العملاء»" state="approved" />'),
}
export const DraftRejected: Story = {
  name: 'مسودة: تُجوهلت',
  render: wrap({ AiDraftCard }, '<AiDraftCard summary="مسودة مشروع «بوابة العملاء»" state="rejected" />'),
}

export const LimitMonthly: Story = {
  name: 'حد: الرسائل الشهرية',
  render: wrap({ AiLimitNotice }, '<AiLimitNotice limit="messages_monthly" :used="500" :max="500" />'),
}
export const LimitToolCalls: Story = {
  name: 'حد: عدد الأدوات',
  render: wrap({ AiLimitNotice }, '<AiLimitNotice limit="max_tool_calls" />'),
}
export const LimitSteps: Story = {
  name: 'حد: عدد الخطوات',
  render: wrap({ AiLimitNotice }, '<AiLimitNotice limit="max_steps" />'),
}
export const LimitTimeout: Story = {
  name: 'حد: المهلة',
  render: wrap({ AiLimitNotice }, '<AiLimitNotice limit="timeout" />'),
}

const records = [
  { type: 'project', id: 12, label: 'بوابة العملاء' },
  { type: 'task', id: 5, label: 'تقرير الربع الثالث' },
  { type: 'meeting', id: 9, label: 'اجتماع المتابعة الأسبوعي' },
]
export const RecordCards: Story = {
  name: 'بطاقات السجلات',
  render: wrap({ AiRecordCards }, '<AiRecordCards :records="records" />', () => ({ records })),
}

export const ToolTraceStates: Story = {
  name: 'أثر الأداة: كل الحالات',
  render: wrap(
    { AiToolTrace },
    '<AiToolTrace summary="مهامك المتأخرة" state="running" /><AiToolTrace summary="مهامك المتأخرة" state="ok" /><AiToolTrace summary="مهام فريق آخر" state="denied" /><AiToolTrace summary="مشاريعك" state="failed" /><AiToolTrace summary="مهامك المتأخرة" state="stalled" />',
  ),
}
