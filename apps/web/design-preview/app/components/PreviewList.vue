<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { PreviewRecord } from '../composables/usePreview'
defineEmits<{ open: [id: number] }>()
const { t, route, items, titleOf, statusColor } = usePreview()
const query = computed(() => String(route.query.q || ''))
const status = computed(() => String(route.query.status || 'all'))
const filtered = computed(() => items.value.filter(record => titleOf(record).toLocaleLowerCase().includes(query.value.toLocaleLowerCase().trim()) && (status.value === 'all' || record.state === status.value)))
const columns = computed<TableColumn<PreviewRecord>[]>(() => [
  { accessorKey: 'id', header: t('number') }, { accessorKey: 'title', header: t('title') },
  { accessorKey: 'owner', header: t('owner') }, { accessorKey: 'state', header: t('status') },
  { accessorKey: 'due', header: t('due') }, { accessorKey: 'progress', header: t('progress') },
])
function clear() { return navigateTo({ query: { ...route.query, q: undefined, status: undefined } }, { replace: true }) }
</script>
<template>
  <div class="space-y-5">
    <div class="preview-record-list">
      <template v-if="filtered.length">
      <UTable class="preview-desktop-records" :data="filtered" :columns="columns" :caption="t('list')" :ui="{ caption: 'sr-only' }">
        <template #id-cell="{ row }"><bdi class="text-muted">{{ row.original.id }}</bdi></template>
        <template #title-cell="{ row }"><UButton color="neutral" variant="link" class="text-highlighted font-medium p-0 text-start whitespace-normal min-w-40 max-w-80" @click="$emit('open', row.original.id)">{{ titleOf(row.original) }}</UButton></template>
        <template #owner-cell="{ row }"><span class="inline-flex items-center gap-2 whitespace-nowrap"><UAvatar :alt="t(`people.${row.original.owner}`)" size="xs" />{{ t(`people.${row.original.owner}`) }}</span></template>
        <template #state-cell="{ row }"><UBadge :color="statusColor(row.original.state)" variant="subtle">{{ t(row.original.state) }}</UBadge></template>
        <template #due-cell="{ row }"><bdi class="text-muted">{{ row.original.due || '—' }}</bdi></template>
        <template #progress-cell="{ row }"><div class="flex items-center gap-2 min-w-36"><PreviewProgress :value="row.original.progress" :label="t('progress')" /><bdi class="text-xs tabular-nums shrink-0 w-10 text-end">{{ row.original.progress }}%</bdi></div></template>
      </UTable>
      <ul class="preview-mobile-records" :aria-label="t('list')">
        <li v-for="record in filtered" :key="record.id">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0"><bdi class="text-xs text-muted">#{{ record.id }}</bdi><UButton color="neutral" variant="link" class="preview-mobile-record-title block" @click="$emit('open', record.id)">{{ titleOf(record) }}</UButton></div>
            <UBadge :color="statusColor(record.state)" variant="subtle" class="shrink-0">{{ t(record.state) }}</UBadge>
          </div>
          <dl class="preview-mobile-record-meta"><div><dt>{{ t('owner') }}</dt><dd>{{ t(`people.${record.owner}`) }}</dd></div><div><dt>{{ t('due') }}</dt><dd><bdi>{{ record.due || '—' }}</bdi></dd></div></dl>
          <div class="flex items-center gap-2"><PreviewProgress :value="record.progress" :label="t('progress')" /><bdi class="text-xs tabular-nums shrink-0 w-10 text-end">{{ record.progress }}%</bdi></div>
        </li>
      </ul>
      </template>
      <PreviewState v-else state="empty" @clear="clear" />
    </div>
    <p class="text-xs text-muted" role="status">{{ filtered.length }} {{ t('results') }}</p>
  </div>
</template>
