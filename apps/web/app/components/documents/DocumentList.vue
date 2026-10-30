<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { DocumentSummary } from '@liwan/contracts'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
const props = defineProps<{ documents: DocumentSummary[]; loading?: boolean; returnTo: string; recordBase?: string }>()
const { t } = useI18n()
const columns = computed<TableColumn<DocumentSummary>[]>(() => [
  { accessorKey: 'name', header: t('documents.columns.name') },
  { accessorKey: 'context', header: t('documents.context') },
  { accessorKey: 'file_count', header: t('documents.files') },
  { accessorKey: 'visibility', header: t('documents.visibility') },
])
const target = (document: DocumentSummary) => ({ path: `${props.recordBase ?? '/documents'}/${document.id}`, query: returnToQuery(props.returnTo) })
</script>
<template>
  <SharedDataTable bare :rows="documents" :columns="columns" row-key="id" :row-to="target" :loading="loading" :caption="t('documents.title')">
    <template #name-cell="{ row }"><NuxtLink :to="target(row.original)" class="block truncate font-semibold text-highlighted hover:underline">{{ row.original.name }}</NuxtLink></template>
    <template #context-cell="{ row }"><span>{{ row.original.context?.label || '—' }}</span></template>
    <template #visibility-cell="{ row }"><SharedStatusBadge tone="neutral" :label="t(`documents.visibilityOptions.${row.original.visibility}`)" /></template>
    <template #mobile-row="{ row }">
      <NuxtLink :to="target(row)" class="block truncate font-semibold text-highlighted hover:underline">{{ row.name }}</NuxtLink>
      <p class="text-sm text-muted">{{ row.context?.label || t(`documents.visibilityOptions.${row.visibility}`) }}</p>
      <span class="text-xs text-muted">{{ t('documents.fileCount', { count: row.file_count }) }}</span>
    </template>
  </SharedDataTable>
</template>
