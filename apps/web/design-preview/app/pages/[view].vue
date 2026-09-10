<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { PreviewRecord, PreviewStatus } from '../composables/usePreview'
const { t, locale, route, module, state, canEdit, items, titleOf, statusColor, link } = usePreview()
const view = computed(() => previewViews.find(value => value === route.params.view))
if (!view.value) throw createError({ statusCode: 404, statusMessage: t('invalidRoute') })
const pageRecord = computed(() => items.value.find(item => item.id === Number(route.query.id || items.value[0]?.id)))
const sheetOpen = computed(() => ['list', 'dashboard'].includes(view.value || '') && ['detail', 'edit'].includes(String(route.query.panel)))
const sheetRecord = computed(() => items.value.find(item => item.id === Number(route.query.record)))
const sheetEdit = computed(() => route.query.panel === 'edit')
const isNew = computed(() => route.query.record === 'new')
const title = computed(() => view.value === 'detail' && pageRecord.value ? titleOf(pageRecord.value) : view.value === 'settings' ? t('settingsTitle') : view.value === 'form' && route.query.id ? t('edit') : t(view.value || 'list'))
const width = computed(() => ['form', 'settings'].includes(view.value || '') ? 'form' : view.value === 'detail' ? 'detail' : 'list')
const chart = computed(() => (['active', 'done', 'waiting'] as PreviewStatus[]).map(key => ({ key, label: t(key), value: items.value.filter(item => item.state === key).length })))
const average = computed(() => Math.round(items.value.reduce((sum, item) => sum + item.progress, 0) / Math.max(items.value.length, 1)))
const recentColumns = computed<TableColumn<PreviewRecord>[]>(() => [{ accessorKey: 'id', header: t('number') }, { accessorKey: 'title', header: t('title') }, { accessorKey: 'state', header: t('status') }])
let returnFocus: HTMLElement | null = null
function openPanel(id?: number, edit = false) {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  return navigateTo({ path: route.path, query: { ...route.query, panel: edit ? 'edit' : 'detail', record: id || 'new' } })
}
function closePanel() { return navigateTo({ path: route.path, query: { ...route.query, panel: undefined, record: undefined } }) }
function retry() { return navigateTo({ path: route.path, query: { ...route.query, state: undefined } }, { replace: true }) }
function clear() { return navigateTo({ path: route.path, query: { ...route.query, state: undefined, q: undefined, status: undefined } }, { replace: true }) }
function restoreFocus(event: Event) { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }) }
function outside(event: Event) { event.preventDefault() }
</script>
<template>
  <PreviewPage :title="title" :width="width" :description="view === 'dashboard' ? t('overviewHint') : view === 'settings' ? t('settingsHint') : view === 'components' ? t('componentHint') : undefined">
    <template #actions>
      <PreviewFilters v-if="view === 'list'" />
      <UButton v-if="view === 'list' || view === 'dashboard'" icon="i-lucide-plus" :label="t('new')" :disabled="!canEdit" @click="view === 'list' ? openPanel(undefined, true) : navigateTo(link('form'))" />
      <template v-if="view === 'detail'"><UButton :to="link('list')" color="secondary" :label="t('back')" /><UButton v-if="pageRecord" :to="link('form', { id: pageRecord.id })" :disabled="!canEdit" icon="i-lucide-square-pen" :label="t('edit')" /></template>
    </template>
    <UAlert v-if="state === 'readonly'" color="neutral" variant="subtle" icon="i-lucide-lock-keyhole" :title="t('readonly')" :description="t('readonlyHint')" />
    <PreviewState v-if="['loading', 'error', 'empty'].includes(state)" :state="state" @retry="retry" @clear="clear" />
    <template v-else-if="view === 'dashboard'">
      <div class="grid sm:grid-cols-3 gap-5">
        <UCard v-for="metric in [{ label: 'total', value: items.length, icon: 'i-lucide-files' }, { label: 'completed', value: items.filter(item => item.state === 'done').length, icon: 'i-lucide-circle-check' }, { label: 'average', value: `${average}%`, icon: 'i-lucide-chart-no-axes-combined' }]" :key="metric.label">
          <div class="flex items-center justify-between gap-3"><span class="text-muted text-sm">{{ t(metric.label) }}</span><UIcon :name="metric.icon" class="size-5 text-muted" /></div><p class="text-3xl font-semibold text-highlighted mt-4"><bdi>{{ metric.value }}</bdi></p>
        </UCard>
      </div>
      <div class="grid xl:grid-cols-[1fr_1.6fr] gap-6">
        <UCard>
          <template #header><h2 class="preview-section-title">{{ t('distribution') }}</h2></template>
          <ClientOnly><PreviewChart :data="chart" :total="items.length" /><template #fallback><USkeleton class="h-56 w-full" /></template></ClientOnly>
          <ul class="space-y-3"><li v-for="item in chart" :key="item.key" class="flex justify-between gap-2"><span class="text-sm">{{ item.label }}</span><bdi class="font-medium">{{ item.value }}</bdi></li></ul>
        </UCard>
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header><div class="flex justify-between items-center"><h2 class="preview-section-title">{{ t('recent') }}</h2><UButton :to="link('list')" color="secondary" :label="t('viewAll')" /></div></template>
          <UTable :data="items.slice(-5).reverse()" :columns="recentColumns">
            <template #id-cell="{ row }"><bdi class="text-muted">{{ row.original.id }}</bdi></template>
            <template #title-cell="{ row }"><UButton color="neutral" variant="link" class="p-0 whitespace-normal text-start" @click="openPanel(row.original.id)">{{ titleOf(row.original) }}</UButton></template>
            <template #state-cell="{ row }"><UBadge :color="statusColor(row.original.state)" variant="subtle">{{ t(row.original.state) }}</UBadge></template>
          </UTable>
        </UCard>
      </div>
    </template>
    <PreviewList v-else-if="view === 'list'" @open="id => openPanel(id)" />
    <template v-else-if="view === 'detail'"><PreviewRecordDetail v-if="pageRecord" :record="pageRecord" /><UAlert v-else color="warning" :title="t('noRecord')" /></template>
    <template v-else-if="view === 'form'"><PreviewRecordForm v-if="!route.query.id || pageRecord" :key="`${module}:${route.query.id || 'new'}`" :record="route.query.id ? pageRecord : undefined" @cancel="navigateTo(link('list'))" @saved="id => navigateTo(link('detail', { id }))" /><UAlert v-else color="warning" :title="t('noRecord')" /></template>
    <PreviewSettings v-else-if="view === 'settings'" />
    <PreviewComponents v-else-if="view === 'components'" />
  </PreviewPage>

  <ClientOnly><Teleport to="body"><div v-if="sheetOpen" class="preview-sheet-overlay fixed z-50 pointer-events-none" aria-hidden="true" /></Teleport></ClientOnly>
  <USlideover :open="sheetOpen" :modal="false" :overlay="false" :ui="{ content: 'preview-sheet' }" :side="locale === 'ar' ? 'right' : 'left'" :title="sheetEdit ? t(isNew ? 'new' : 'edit') : sheetRecord ? titleOf(sheetRecord) : t('detail')" :description="t('demo')" :content="{ onInteractOutside: outside, onPointerDownOutside: outside, onCloseAutoFocus: restoreFocus }" @update:open="open => { if (!open) closePanel() }">
    <template #actions><UButton :to="link(sheetEdit ? 'form' : 'detail', { id: sheetRecord?.id })" color="secondary" :label="t('fullPage')" /></template>
    <template #body>
      <PreviewRecordForm v-if="sheetEdit && (isNew || sheetRecord)" :key="`${module}:${route.query.record}:edit`" :record="sheetRecord" @cancel="closePanel" @saved="closePanel" />
      <template v-else-if="sheetRecord"><PreviewRecordDetail :record="sheetRecord" /><UButton class="mt-6" :label="t('edit')" :disabled="!canEdit" icon="i-lucide-square-pen" @click="openPanel(sheetRecord.id, true)" /></template>
      <UAlert v-else color="warning" :title="t('noRecord')" />
    </template>
  </USlideover>
</template>
