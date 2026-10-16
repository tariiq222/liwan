import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AiComposer from '../../app/components/ai/AiComposer.vue'
import AiConfirmCard from '../../app/components/ai/AiConfirmCard.vue'
import AiDraftCard from '../../app/components/ai/AiDraftCard.vue'
import AiLimitNotice from '../../app/components/ai/AiLimitNotice.vue'
import AiMessage from '../../app/components/ai/AiMessage.vue'
import AiRecordCards from '../../app/components/ai/AiRecordCards.vue'
import AiToolTrace from '../../app/components/ai/AiToolTrace.vue'
import { storyContext } from '../support/context'

const components = { AiComposer, AiConfirmCard, AiDraftCard, AiLimitNotice, AiMessage, AiRecordCards, AiToolTrace }

const meta = {
  title: 'Ai/Thread',
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/ai/index.vue') },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const records = [
  { type: 'task', id: 5, label: 'تقرير الربع الثالث' },
  { type: 'project', id: 12, label: 'بوابة العملاء' },
]

export const Conversation: Story = {
  name: 'محادثة كاملة',
  render: () => ({
    components,
    setup: () => ({ records }),
    template: `<div class="mx-auto flex max-w-2xl flex-col gap-4">
      <AiMessage role="user" text="ما مهامي المتأخرة؟" />
      <AiToolTrace summary="مهامك المتأخرة" state="ok" />
      <AiMessage role="assistant" text="عندك مهمتان متأخرتان، وكلتاهما في مشروع بوابة العملاء." />
      <AiRecordCards :records="records" />
      <AiComposer :disabled="false" :pending="false" />
    </div>`,
  }),
}

export const Streaming: Story = {
  name: 'الجواب يُبث',
  render: () => ({
    components,
    template: `<div class="mx-auto flex max-w-2xl flex-col gap-4">
      <AiMessage role="user" text="لخّص حالة المشاريع" />
      <AiToolTrace summary="مشاريعك" state="running" />
      <AiMessage role="assistant" text="عندك ثلاثة مشاريع نشطة" streaming />
      <AiComposer :disabled="false" :pending="true" />
    </div>`,
  }),
}

export const WaitingConfirm: Story = {
  name: 'بانتظار تأكيد المستخدم',
  render: () => ({
    components,
    template: `<div class="mx-auto flex max-w-2xl flex-col gap-4">
      <AiMessage role="user" text="أنهِ مهمة تقرير الربع" />
      <AiConfirmCard summary="سأغيّر حالة المهمة «تقرير الربع» إلى منجزة" state="pending" />
      <AiComposer :disabled="true" :pending="false" />
    </div>`,
  }),
}

export const WaitingDraft: Story = {
  name: 'مسودة مشروع جاهزة',
  render: () => ({
    components,
    template: `<div class="mx-auto flex max-w-2xl flex-col gap-4">
      <AiMessage role="user" text="جهّز لي مشروع بوابة العملاء" />
      <AiDraftCard summary="مسودة مشروع «بوابة العملاء»" state="pending" />
      <AiComposer :disabled="true" :pending="false" />
    </div>`,
  }),
}

export const MonthlyLimit: Story = {
  name: 'بلوغ حد الرسائل',
  render: () => ({
    components,
    template: `<div class="mx-auto flex max-w-2xl flex-col gap-4">
      <AiLimitNotice limit="messages_monthly" :used="500" :max="500" />
      <AiComposer :disabled="true" :pending="false" />
    </div>`,
  }),
}
