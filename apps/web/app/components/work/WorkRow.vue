<script setup lang="ts">
import type { AttentionRowWithModule } from '@/composables/nav/attentionModel'

// One row of «مهامي» / «ابدأ بالأهم»: the record as a link, the application it comes from as a small chip, its caption, and the
// optional suggestion as plain text. An urgent row carries the warm dot and an «عاجل» pill, so urgency never relies on colour alone.
defineProps<{ row: AttentionRowWithModule; sourceLabel: string }>()
const { t } = useI18n()
</script>

<template>
  <li class="flex min-w-0 items-start gap-3 px-(--webvue-card-pad-dense) py-3" data-testid="work-row" :data-tone="row.tone">
    <span aria-hidden="true" :class="['mt-1.5 size-2 shrink-0 rounded-full', row.tone === 'urgent' ? 'bg-warning' : 'bg-primary']" />
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <NuxtLink :to="row.to" class="min-w-0 break-words text-sm font-medium text-highlighted hover:underline focus-visible:ring-2 focus-visible:ring-primary" data-testid="work-row-link">{{ row.label }}</NuxtLink>
        <UBadge v-if="row.tone === 'urgent'" color="warning" variant="soft" size="sm" class="rounded-full" :label="t('myTasks.work.urgent')" data-testid="work-row-urgent" />
        <UBadge color="neutral" variant="outline" size="sm" class="rounded-full" :label="sourceLabel" data-testid="work-row-source" />
      </div>
      <p v-if="row.caption" class="mt-0.5 text-xs text-muted">{{ row.caption }}</p>
      <p v-if="row.suggestion" class="mt-1 break-words text-sm text-default">{{ row.suggestion }}</p>
    </div>
  </li>
</template>
