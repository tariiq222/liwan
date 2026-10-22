<script setup lang="ts">
import type { AiRecordRef } from '@webvue/contracts'

// Numbered source chips under a reply: one per record the tools returned, each linking to its record.
const props = defineProps<{ records: AiRecordRef[] }>()
const { t } = useI18n()

// Only records of the platform's own pages link; any other type is shown as text.
function recordPath(record: AiRecordRef): string | null {
  if (record.type === 'project') return `/projects/${record.id}`
  if (record.type === 'task') return `/tasks/${record.id}`
  return null
}

const NuxtLink = resolveComponent('NuxtLink')
const CHIP = 'inline-flex max-w-full items-center gap-2 rounded-full bg-default py-1 ps-1 pe-3 text-sm text-highlighted ring ring-default'
</script>

<template>
  <section :aria-label="t('ai.thread.records')" class="flex flex-wrap items-center gap-2">
    <span class="text-xs font-medium text-muted" aria-hidden="true">{{ t('ai.thread.records') }}</span>
    <ul class="flex flex-wrap gap-2">
      <li v-for="(record, index) in props.records" :key="`${record.type}:${record.id}`" class="max-w-full" data-testid="ai-record">
        <component :is="recordPath(record) ? NuxtLink : 'span'" v-bind="recordPath(record) ? { to: recordPath(record) } : {}" :class="[CHIP, recordPath(record) && 'hover:bg-elevated focus-visible:ring-2 focus-visible:ring-primary']">
          <span class="grid size-5 shrink-0 place-items-center rounded-full bg-(--webvue-nav-active) text-xs font-medium text-(--webvue-rail-active-ink)">{{ index + 1 }}</span>
          <span class="truncate">{{ record.label }}</span>
        </component>
      </li>
    </ul>
  </section>
</template>
