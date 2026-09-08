<script setup lang="ts">
import { sanitizeHtml } from '@/utils/sanitize'
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
      <h2 class="text-lg font-semibold">{{ props.document.name }}</h2>
      <p class="text-sm text-muted-foreground">{{ props.document.department.name }}</p>
    </div>
    <div class="text-sm" v-html="sanitizeHtml(props.document.body)" />
    <div v-if="props.document.attachment_ids.length" class="grid gap-2">
      <h3 class="text-sm font-medium">{{ t('hr.docs.attachments') }}</h3>
      <ul class="grid gap-2 text-sm">
        <li v-for="att in props.document.attachment_ids" :key="att.id">
          <a :href="`/web/content/${att.id}`" class="inline-flex rounded-md px-1 py-0.5 underline decoration-primary/60 underline-offset-2 hover:bg-muted" target="_blank" rel="noreferrer" download>
            {{ att.name }}
          </a>
          <span class="ms-2 text-muted-foreground">{{ formatSize(att.file_size) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
