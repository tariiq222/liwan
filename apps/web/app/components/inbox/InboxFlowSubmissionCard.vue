<script setup lang="ts">
import type { InboxFlowSubmission } from '@webvue/contracts'
import type { RouteLocationRaw } from 'vue-router'
import { answerDisplay } from '@/composables/inbox/inboxFlow'

// A customer's completed form: the form's name and each question with the answer given. A choice shows the titles that
// were chosen, a consent shows yes or no. Labels are those of the form when it was answered, so a later copy of the
// form never changes a stored answer. `link` points at the message of the answer in the thread.
const props = defineProps<{ submission: InboxFlowSubmission; link?: RouteLocationRaw; linkLabel?: string; showTime?: boolean }>()
const { t, locale } = useI18n()
const when = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(props.submission.submitted_at)))
const rows = computed(() => props.submission.answers.map(answer => ({ key: answer.key, label: answer.label, display: answerDisplay(answer) })))
</script>

<template>
  <article class="flex flex-col gap-2" data-testid="inbox-flow-submission">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h4 class="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-highlighted">
        <UIcon name="i-lucide-clipboard-check" class="size-4 shrink-0 text-primary" aria-hidden="true" />
        <bdi class="truncate" data-testid="inbox-flow-submission-name">{{ props.submission.flow?.name ?? t('inbox.flows.unknown') }}</bdi>
      </h4>
      <time v-if="props.showTime" :datetime="props.submission.submitted_at" class="text-xs text-muted">{{ when }}</time>
    </header>
    <dl v-if="rows.length" class="flex flex-col gap-1.5">
      <div v-for="row in rows" :key="row.key" class="flex flex-col" data-testid="inbox-flow-answer">
        <dt class="text-xs text-muted break-words">{{ row.label }}</dt>
        <dd class="text-sm break-words">
          <span v-if="row.display.kind === 'boolean'" class="inline-flex items-center gap-1" :class="row.display.value ? 'text-success' : 'text-muted'">
            <UIcon :name="row.display.value ? 'i-lucide-check' : 'i-lucide-x'" class="size-4" aria-hidden="true" />{{ row.display.value ? t('inbox.flows.answer.yes') : t('inbox.flows.answer.no') }}
          </span>
          <bdi v-else-if="row.display.text" dir="auto" class="whitespace-pre-wrap">{{ row.display.text }}</bdi>
          <span v-else class="text-muted">{{ t('inbox.flows.answer.empty') }}</span>
        </dd>
      </div>
    </dl>
    <p v-else class="text-sm text-muted">{{ t('inbox.flows.answer.none') }}</p>
    <NuxtLink v-if="props.link" :to="props.link" class="self-start text-xs text-brand-link underline" data-testid="inbox-flow-submission-link">{{ props.linkLabel ?? t('inbox.flows.answer.openMessage') }}</NuxtLink>
  </article>
</template>
