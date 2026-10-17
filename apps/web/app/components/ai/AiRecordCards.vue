<script setup lang="ts">
import type { AiRecordRef } from '@webvue/contracts'

const props = defineProps<{ records: AiRecordRef[] }>()
const { t } = useI18n()

// Only records of the platform's own pages link; any other type is shown as text.
function recordPath(record: AiRecordRef): string | null {
  if (record.type === 'project') return `/projects/${record.id}`
  if (record.type === 'task') return `/tasks/${record.id}`
  return null
}
</script>

<template>
  <section :aria-label="t('ai.thread.records')" class="flex flex-col gap-2">
    <h2 class="text-xs font-medium text-muted">{{ t('ai.thread.records') }}</h2>
    <ul class="flex flex-wrap gap-2">
      <SharedSubCard v-for="record in props.records" :key="`${record.type}:${record.id}`" as="li" class="max-w-full py-2 text-sm text-highlighted" data-testid="ai-record">
        <NuxtLink v-if="recordPath(record)" :to="recordPath(record)!" class="inline-flex max-w-full items-center gap-2 rounded-control hover:text-primary focus-visible:ring-2 focus-visible:ring-primary">
          <UIcon :name="record.type === 'project' ? 'i-lucide-folder-kanban' : 'i-lucide-square-check'" aria-hidden="true" class="size-4 shrink-0 text-muted" />
          <span class="truncate">{{ record.label }}</span>
        </NuxtLink>
        <span v-else class="block truncate">{{ record.label }}</span>
      </SharedSubCard>
    </ul>
  </section>
</template>
