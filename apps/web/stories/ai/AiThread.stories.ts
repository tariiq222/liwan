import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AiAvatar from '../../app/components/ai/AiAvatar.vue'
import AiComposer from '../../app/components/ai/AiComposer.vue'
import AiConfirmCard from '../../app/components/ai/AiConfirmCard.vue'
import AiContextChip from '../../app/components/ai/AiContextChip.vue'
import AiCopyButton from '../../app/components/ai/AiCopyButton.vue'
import AiDraftCard from '../../app/components/ai/AiDraftCard.vue'
import AiLimitNotice from '../../app/components/ai/AiLimitNotice.vue'
import AiMessage from '../../app/components/ai/AiMessage.vue'
import AiRecordCards from '../../app/components/ai/AiRecordCards.vue'
import AiSuggestionChips from '../../app/components/ai/AiSuggestionChips.vue'
import AiToolTrace from '../../app/components/ai/AiToolTrace.vue'
import AiTypingDots from '../../app/components/ai/AiTypingDots.vue'
import { storyContext } from '../support/context'

const components = { AiAvatar, AiComposer, AiConfirmCard, AiContextChip, AiCopyButton, AiDraftCard, AiLimitNotice, AiMessage, AiRecordCards, AiSuggestionChips, AiToolTrace, AiTypingDots }

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
      <AiMessage role="assistant" text="عندك مهمتان متأخرتان، وكلتاهما في مشروع بوابة العملاء.">
        <template #footer>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <AiRecordCards :records="records" />
            <AiCopyButton text="عندك مهمتان متأخرتان، وكلتاهما في مشروع بوابة العملاء." />
          </div>
        </template>
      </AiMessage>
      <AiSuggestionChips :items="['ما أهم مهمة؟', 'لخّص لي ذلك باختصار']" label="أسئلة متابعة" />
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

const arabicMarkdown = `عندك **ثلاث مهام** متأخرة، وأهمها:

1. **تقرير الربع الثالث** في مشروع بوابة العملاء
2. مراجعة العقد مع *قسم المشتريات*

يمكنك فتح [صفحة المشروع](https://example.com/projects/12) أو استخدام \`/projects\` للتفاصيل.

- أنهِ المهمة الأولى اليوم
- راسل **الفريق** عند الانتهاء`

const englishMarkdown = `You have **three overdue tasks**. The most urgent:

1. **Q3 report** in the Customer Portal project
2. Contract review with *Procurement*

Open the [project page](https://example.com/projects/12) or run \`/projects\` for details.

- Finish the first task today
- Tell the **team** when done`

const codeAnswer = 'يمكنك استدعاء الواجهة هكذا:\n\n```ts\nconst res = await fetch(\'/api/v1/tasks?state=late&limit=50&order=deadline_desc&include=project,assignee\')\nconst { items, total } = await res.json()\n```\n\nوالنتيجة تأتي بصيغة `{items, total}`.'

export const MarkdownArabic: Story = {
  name: 'جواب بتنسيق: عربي',
  render: () => ({
    components,
    setup: () => ({ text: arabicMarkdown }),
    template: `<div class="mx-auto flex max-w-2xl flex-col gap-4">
      <AiMessage role="user" text="ما مهامي المتأخرة؟" />
      <AiMessage role="assistant" :text="text" />
    </div>`,
  }),
}

export const MarkdownEnglish: Story = {
  name: 'جواب بتنسيق: إنجليزي',
  render: () => ({
    components,
    setup: () => ({ text: englishMarkdown }),
    template: `<div class="mx-auto flex max-w-2xl flex-col gap-4">
      <AiMessage role="user" text="What are my late tasks?" />
      <AiMessage role="assistant" :text="text" />
    </div>`,
  }),
}

export const MarkdownCodeBlock: Story = {
  name: 'جواب فيه كتلة شيفرة',
  render: () => ({
    components,
    setup: () => ({ text: codeAnswer }),
    template: `<div class="mx-auto flex max-w-2xl flex-col gap-4">
      <AiMessage role="assistant" :text="text" />
    </div>`,
  }),
}

export const MarkdownStreaming: Story = {
  name: 'جواب يُبث بتنسيق ناقص',
  render: () => ({
    components,
    template: `<div class="mx-auto flex max-w-2xl flex-col gap-4">
      <AiMessage role="user" text="لخّص حالة المشاريع" />
      <AiMessage role="assistant" text="عندك **ثلاثة مشاريع نشطة، وأهمها [بوابة العملاء](https://exa" streaming />
    </div>`,
  }),
}

export const Compact: Story = {
  name: 'مضغوط (للشيت)',
  render: () => ({
    components,
    setup: () => ({ records }),
    template: `<div class="mx-auto flex max-w-sm flex-col gap-4">
      <AiMessage role="user" text="ما مهامي المتأخرة؟" compact />
      <AiMessage role="assistant" text="عندك مهمتان متأخرتان." compact>
        <template #footer><AiRecordCards :records="records" /></template>
      </AiMessage>
      <AiComposer :disabled="false" :pending="false" compact />
    </div>`,
  }),
}

export const EmptyStart: Story = {
  name: 'بداية محادثة',
  render: () => ({
    components,
    setup: () => ({ starters: ['ما مهامي المتأخرة؟', 'كيف حال مشاريعي النشطة؟', 'ماذا عندي هذا الأسبوع؟', 'ما اجتماعاتي القادمة؟'] }),
    template: `<div class="mx-auto flex max-w-180 flex-col items-center gap-4 text-center">
      <AiAvatar size="lg" />
      <h2 class="text-2xl font-bold text-highlighted">أهلًا نورة</h2>
      <p class="text-base text-muted">كيف أساعدك في عملك اليوم؟</p>
      <AiContextChip page="project" />
      <AiComposer class="w-full text-start" :disabled="false" :pending="false" />
      <AiSuggestionChips :items="starters" label="أسئلة للبدء" />
    </div>`,
  }),
}

export const Typing: Story = {
  name: 'مؤشر الكتابة',
  render: () => ({ components, template: '<div class="mx-auto flex max-w-2xl gap-3"><AiAvatar /><AiTypingDots /></div>' }),
}
