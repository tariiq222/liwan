<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { DocumentSummary } from '@liwan/contracts'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
// `returnTo` may be a function: the list state is then read at the moment of the click, so a search typed a
// moment ago (before its debounce wrote the URL) travels with the record link.
const props = defineProps<{ documents: DocumentSummary[]; loading?: boolean; returnTo: string | (() => string); recordBase?: string }>()
const router = useRouter()
const { t } = useI18n()
const columns = computed<TableColumn<DocumentSummary>[]>(() => [
  { accessorKey: 'name', header: t('documents.columns.name'), meta: { class: { th: 'min-w-56 w-[34%]', td: 'max-w-0' } } },
  { accessorKey: 'context', header: t('documents.context'), meta: { class: { th: 'w-44', td: 'w-44 max-w-0' } } },
  { accessorKey: 'file_count', header: t('documents.files'), meta: { class: { th: 'w-24', td: 'w-24 whitespace-nowrap' } } },
  { accessorKey: 'visibility', header: t('documents.visibility'), meta: { class: { th: 'w-36', td: 'w-36 whitespace-nowrap' } } },
  // The list has an «expired» filter but showed no expiry, so a user could filter by a date the table never printed.
  { accessorKey: 'expiry_date', header: t('documents.columns.expiry'), meta: { class: { th: 'w-32', td: 'w-32 whitespace-nowrap' } } },
])
const target = (document: DocumentSummary) => ({ path: `${props.recordBase ?? '/documents'}/${document.id}`, query: returnToQuery(typeof props.returnTo === 'function' ? props.returnTo() : props.returnTo) })
// Runs in the capture phase so the link's own navigation, built at the last render, does not go first.
function open(event: MouseEvent, document: DocumentSummary) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  void router.push(target(document)).catch(() => undefined)
}
</script>
<template>
  <SharedDataTable bare :rows="documents" :columns="columns" row-key="id" :row-to="target" :loading="loading" :caption="t('documents.title')">
    <template #name-cell="{ row }"><NuxtLink :to="target(row.original)" class="block truncate font-semibold text-highlighted hover:underline" @click.capture="open($event, row.original)">{{ row.original.name }}</NuxtLink></template>
    <template #context-cell="{ row }"><span class="block truncate">{{ row.original.context?.label || '—' }}</span></template>
    <template #visibility-cell="{ row }"><SharedStatusBadge tone="neutral" :label="t(`documents.visibilityOptions.${row.original.visibility}`)" /></template>
    <template #expiry-cell="{ row }"><span class="tabular-nums">{{ row.original.expiry_date ? formatDate(row.original.expiry_date) : '—' }}</span></template>
    <template #mobile-row="{ row }">
      <NuxtLink :to="target(row)" class="block truncate font-semibold text-highlighted hover:underline" @click.capture="open($event, row)">{{ row.name }}</NuxtLink>
      <p class="text-sm text-muted">{{ row.context?.label || t(`documents.visibilityOptions.${row.visibility}`) }}</p>
      <span class="text-xs text-muted">{{ t('documents.fileCount', { count: row.file_count }) }}</span>
    </template>
  </SharedDataTable>
</template>
