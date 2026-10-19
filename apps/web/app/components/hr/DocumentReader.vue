<script setup lang="ts">
import type { HrDocument } from '@/composables/useHrDocuments'

const props = defineProps<{ document: HrDocument; hideTitle?: boolean }>()

const { t } = useI18n()

function formatSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="grid gap-4">
    <div v-if="!hideTitle">
      <h2 class="text-lg font-semibold text-highlighted">{{ props.document.name }}</h2>
      <p class="text-sm text-muted">{{ props.document.department.name }}</p>
    </div>
    <SharedRichText :html="props.document.body" size="sm" />
    <div v-if="props.document.attachment_ids.length" class="grid gap-2">
      <h3 class="text-sm font-medium text-highlighted">{{ t('hr.docs.attachments') }}</h3>
      <ul class="grid gap-2 text-sm">
        <li v-for="att in props.document.attachment_ids" :key="att.id">
          <a :href="att.url" class="inline-flex rounded-md px-1 py-0.5 underline decoration-primary/60 underline-offset-2 hover:bg-elevated" target="_blank" rel="noreferrer" download>
            {{ att.name }}
          </a>
          <span class="ms-2 text-muted">{{ formatSize(att.file_size) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
