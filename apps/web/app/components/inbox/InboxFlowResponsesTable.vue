<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { InboxFlow, InboxFlowSubmission } from '@webvue/contracts'
import { answerColumns, answerDisplay, answerOf, conversationRoute } from '@/composables/inbox/inboxFlow'

// The answers to one form: the date, the contact (a link to the answer in the conversation) and one column per
// question of the form, in its order. A choice shows the titles chosen, a date its day, a consent a tick or a cross.
// Filters and paging belong to the page.
const props = defineProps<{ flow?: InboxFlow; submissions: InboxFlowSubmission[]; loading?: boolean; error?: unknown; page: number; pages: number }>()
const emit = defineEmits<{ 'update:page': [page: number]; retry: [] }>()
const { t, locale } = useI18n()
const when = (value: string) => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const questions = computed(() => answerColumns(props.flow, props.submissions))
const columns = computed<TableColumn<InboxFlowSubmission>[]>(() => [
  { id: 'date', header: t('inbox.flows.responses.date') },
  { id: 'contact', header: t('inbox.flows.responses.contact') },
  ...questions.value.map(question => ({ id: `answer-${question.key}`, header: question.label })),
])
type CellKind = 'none' | 'yes' | 'no' | 'text'
function cellKind(submission: InboxFlowSubmission, key: string): CellKind {
  const answer = answerOf(submission.answers, key)
  if (!answer) return 'none'
  const display = answerDisplay(answer)
  return display.kind === 'boolean' ? (display.value ? 'yes' : 'no') : 'text'
}
function cellText(submission: InboxFlowSubmission, key: string): string {
  const answer = answerOf(submission.answers, key)
  const display = answer ? answerDisplay(answer) : null
  return display?.kind === 'text' && display.text ? display.text : '—'
}
const link = (submission: InboxFlowSubmission) => conversationRoute(submission.conversation_id, submission.message_id)
</script>

<template>
  <SharedDataTable
    :rows="props.submissions"
    :columns="columns"
    row-key="id"
    :loading="props.loading"
    :error="props.error"
    :empty-text="t('inbox.flows.responses.empty')"
    :page="props.page"
    :pages="props.pages"
    :caption="t('inbox.flows.responses.title')"
    data-testid="inbox-flow-responses"
    @update:page="emit('update:page', $event)"
    @retry="emit('retry')"
  >
    <template #date-cell="{ row }"><time :datetime="row.original.submitted_at" class="whitespace-nowrap">{{ when(row.original.submitted_at) }}</time></template>
    <template #contact-cell="{ row }">
      <NuxtLink :to="link(row.original)" class="font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :data-testid="`inbox-flow-response-contact-${row.original.id}`">{{ row.original.contact.name }}</NuxtLink>
    </template>
    <template v-for="question in questions" :key="question.key" #[`answer-${question.key}-cell`]="{ row }">
      <span v-if="cellKind(row.original, question.key) === 'none'" class="text-muted">—</span>
      <span v-else-if="cellKind(row.original, question.key) !== 'text'" class="inline-flex items-center gap-1" :class="cellKind(row.original, question.key) === 'yes' ? 'text-success' : 'text-muted'">
        <UIcon :name="cellKind(row.original, question.key) === 'yes' ? 'i-lucide-check' : 'i-lucide-x'" class="size-4" aria-hidden="true" />
        <span class="sr-only">{{ cellKind(row.original, question.key) === 'yes' ? t('inbox.flows.answer.yes') : t('inbox.flows.answer.no') }}</span>
      </span>
      <bdi v-else dir="auto" class="whitespace-pre-wrap">{{ cellText(row.original, question.key) }}</bdi>
    </template>
    <template #mobile-row="{ row }">
      <div class="flex items-start justify-between gap-3">
        <NuxtLink :to="link(row)" class="min-w-0 truncate text-base font-semibold text-highlighted hover:underline">{{ row.contact.name }}</NuxtLink>
        <time :datetime="row.submitted_at" class="shrink-0 text-xs text-muted">{{ when(row.submitted_at) }}</time>
      </div>
      <dl class="mt-2 grid gap-1.5 text-sm">
        <div v-for="answer in row.answers" :key="answer.key">
          <dt class="text-xs text-muted">{{ answer.label }}</dt>
          <dd>
            <template v-if="cellKind(row, answer.key) !== 'text'">{{ cellKind(row, answer.key) === 'yes' ? t('inbox.flows.answer.yes') : t('inbox.flows.answer.no') }}</template>
            <bdi v-else dir="auto">{{ cellText(row, answer.key) }}</bdi>
          </dd>
        </div>
      </dl>
    </template>
  </SharedDataTable>
</template>
