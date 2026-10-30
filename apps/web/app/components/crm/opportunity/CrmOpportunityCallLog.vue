<script setup lang="ts">
import type { CrmCall } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'

// The calls made on one opportunity, newest first: outcome, time, who called, how long and the note.
// Older calls load a page at a time: `hasMore` shows the button and `more` asks the page for the next one.
defineProps<{ calls: CrmCall[]; total: number; hasMore: boolean; loadingMore: boolean }>()
defineEmits<{ more: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('crm.opportunities.call.log')">
    <SharedEmptyState v-if="!calls.length" :title="t('crm.opportunities.call.logEmpty')" />
    <ol v-else class="divide-y divide-default" data-testid="crm-call-log">
      <li v-for="call in calls" :key="call.id" class="grid gap-1 py-3 first:pt-0 last:pb-0">
        <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span class="font-semibold text-highlighted">{{ call.outcome?.name ?? t('crm.opportunities.call.logNoOutcome') }}</span>
          <time class="text-sm text-muted" :datetime="call.created_at">{{ formatDateTime(call.created_at) }}</time>
          <span v-if="call.duration_minutes" class="text-sm text-muted">{{ t('crm.opportunities.call.logMinutes', { minutes: call.duration_minutes }) }}</span>
          <span v-if="call.user" class="text-sm text-muted">{{ t('crm.opportunities.call.logBy', { name: call.user.name }) }}</span>
        </div>
        <p v-if="call.note" class="whitespace-pre-line break-words text-sm">{{ call.note }}</p>
      </li>
    </ol>
    <div v-if="calls.length" class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-default pt-3">
      <p class="text-sm text-muted">{{ t('crm.opportunities.call.logCount', { shown: calls.length, total }) }}</p>
      <UButton v-if="hasMore" type="button" color="neutral" variant="outline" size="sm" :loading="loadingMore" :disabled="!hydrated || loadingMore" :label="t('crm.opportunities.call.logMore')" data-testid="crm-call-log-more" @click="$emit('more')" />
    </div>
  </SharedRecordSection>
</template>
