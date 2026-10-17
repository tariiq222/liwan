<script setup lang="ts">
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { useProjectRegister, useDeleteProjectRegister } from '@/composables/useProjectGovernance'
import { governanceFilters } from '@/composables/projectGovernanceKeys'
import { REGISTER_PRIORITY_TONE, REGISTER_STATUS_TONE, registerScoreTone } from '@/components/pmo/projects/governance/state'
import { ApiError } from '@/composables/useApi'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/projects\/[^/]+\/register/, '')
  return rest === '' || rest === '/new'
})
const id = computed(() => Number(route.params.id))
const parsed = computed(() => governanceFilters(route.query))
const filters = computed(() => (parsed.value))
const list = useProjectRegister(computed(() => isListRoute.value ? id.value : null), filters)
const remove = useDeleteProjectRegister()
const confirmDeleteId = ref<number | null>(null)
const error = ref<string | null>(null)
function setFilter(key: string, value: string) {
  router.replace({ query: { ...route.query, [key]: value || undefined, offset: undefined } })
}
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
watch(search, value => setFilter('q', value), { flush: 'sync' })
watch(() => route.query.q, value => { search.value = typeof value === 'string' ? value : '' })
const q = search
const PAGE = 50
const pageNumber = computed(() => Math.floor((parsed.value.offset ?? 0) / PAGE) + 1)
const pages = computed(() => Math.max(1, pageNumber.value, Math.ceil((list.data.value?.total ?? 0) / PAGE)))
function setPage(next: number) {
  if (!hydrated.value || list.isFetching.value || next < 1 || next > pages.value) return
  void router.push({ query: { ...route.query, offset: next === 1 ? undefined : String((next - 1) * PAGE) } })
}
// A link out of the list carries the list's own state, with the search being typed; a referrer's returnTo is dropped.
const liveQuery = computed(() => {
  const { returnTo: _referrer, ...rest } = route.query
  return { ...rest, q: search.value.trim() || undefined }
})
const itemTo = (item: { id: number }) => ({ path: `/projects/${id.value}/register/${item.id}`, query: liveQuery.value })
const createTo = computed(() => list.data.value?.can_manage ? { path: `/projects/${id.value}/register/new`, query: liveQuery.value } : undefined)
const kind = computed(() => parsed.value.kind ?? 'all')
const status = computed(() => parsed.value.status ?? 'all')
const priority = computed(() => parsed.value.priority ?? 'all')
// The choice controls emit a plain string, so each filter gets its own
// setter instead of a writable computed whose setter would inherit the
// getter's narrowed union type.
function setKind(value: unknown) {
  setFilter('kind', value === 'all' ? '' : String(value ?? ''))
}
function setStatus(value: unknown) {
  setFilter('status', value === 'all' ? '' : String(value ?? ''))
}
function setPriority(value: unknown) {
  setFilter('priority', value === 'all' ? '' : String(value ?? ''))
}
const activeFilterCount = computed(() => Number(Boolean(q.value.trim())) + Number(Boolean(parsed.value.kind)) + Number(Boolean(parsed.value.status)) + Number(Boolean(parsed.value.priority)))
function clearFilters() {
  router.replace({ query: { ...route.query, q: undefined, kind: undefined, status: undefined, priority: undefined, offset: undefined } })
}

const kindItems = computed(() => [
  { value: 'all', label: t('projects.clarity.allKinds') },
  { value: 'risk', label: t('projects.governance.register.risk') },
  { value: 'issue', label: t('projects.governance.register.issue') },
])
const statusItems = computed(() => [
  { value: 'all', label: t('projects.clarity.allStatuses') },
  { value: 'open', label: t('projects.governance.register.open') },
  { value: 'in_progress', label: t('projects.governance.register.inProgress') },
  { value: 'resolved', label: t('projects.governance.register.resolved') },
  { value: 'closed', label: t('projects.governance.register.closed') },
])
const priorityItems = computed(() => [
  { value: 'all', label: t('projects.clarity.allPriorities') },
  ...['low', 'normal', 'high', 'critical'].map(value => ({ value, label: t(`projects.governance.register.${value}`) })),
])
function itemLabel(items: { value: string; label: string }[], value: string) {
  return items.find(item => item.value === value)?.label ?? value
}
const columns = computed(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t) },
  { accessorKey: 'title', header: t('projects.governance.register.itemTitle') },
  { accessorKey: 'kind', header: t('projects.governance.register.kind') },
  { accessorKey: 'priority', header: t('projects.governance.register.priority') },
  { accessorKey: 'status', header: t('projects.governance.register.status') },
  { accessorKey: 'score', header: t('projects.clarity.riskScore') },
  { id: 'actions', header: t('app.actions'), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } },
])
async function deleteItem(item: { id: number }) {
  error.value = null
  if (confirmDeleteId.value !== item.id) {
    confirmDeleteId.value = item.id
    return
  }
  try {
    await remove.mutateAsync({ projectId: id.value, id: item.id })
    confirmDeleteId.value = null
  }
  catch (cause) {
    error.value = cause instanceof ApiError && cause.code === 'stakeholder_assigned'
      ? t('projects.governance.stakeholderAssigned')
      : cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}
const confirmItem = computed(() => list.data.value?.items.find(item => item.id === confirmDeleteId.value) ?? null)
// The row menu only opens the confirmation; deletion happens from SharedInlineConfirm.
function rowActions(item: { id: number; title: string }): RowAction[] {
  return [{
    label: t('projects.governance.delete'),
    icon: 'i-lucide-trash-2',
    destructive: true,
    disabled: remove.isPending.value,
    onSelect: () => {
      if (confirmDeleteId.value === item.id) return
      void deleteItem(item)
      void nextTick(() => document.querySelector('[data-testid="register-delete-confirm"]')?.scrollIntoView({ block: 'nearest' }))
    },
  }]
}
function cancelDelete() {
  confirmDeleteId.value = null
  error.value = null
}
function openLiveItem(event: MouseEvent, item: { id: number }) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  void router.push(itemTo(item))
}
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    hide-header
    :title="t('projects.refresh.workspace.registerTitle')"
    :create-to="createTo"
    :create-label="t('projects.clarity.addRegister')"
    create-test-id="register-create"
  >
    <template #filters>
      <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
        <template #search>
          <UInput v-model="search" :aria-label="t('projects.clarity.registerSearch')" :disabled="!hydrated" :placeholder="t('projects.clarity.registerSearch')" icon="i-lucide-search" class="w-full min-w-52" />
        </template>
        <template #default>
          <SharedFilterChoice layout="segment" :label="t('projects.governance.register.kind')" :items="kindItems" :model-value="kind" :disabled="!hydrated" @update:model-value="setKind($event)" />
          <SharedFilterChoice :label="t('projects.governance.register.status')" :items="statusItems" :model-value="status" :disabled="!hydrated" @update:model-value="setStatus($event)" />
          <SharedFilterChoice :label="t('projects.governance.register.priority')" :items="priorityItems" :model-value="priority" :disabled="!hydrated" @update:model-value="setPriority($event)" />
        </template>
        <template #active>
          <div v-if="activeFilterCount" class="flex flex-wrap items-center gap-2">
            <SharedFilterChip v-if="search.trim()" :label="`${t('projects.clarity.registerSearch')}: ${search}`" @remove="search = ''" />
            <SharedFilterChip v-if="parsed.kind" :label="itemLabel(kindItems, kind)" @remove="setKind('all')" />
            <SharedFilterChip v-if="parsed.status" :label="itemLabel(statusItems, status)" @remove="setStatus('all')" />
            <SharedFilterChip v-if="parsed.priority" :label="itemLabel(priorityItems, priority)" @remove="setPriority('all')" />
          </div>
        </template>
      </FilterBar>
    </template>

    <SharedInlineConfirm
      v-if="confirmItem"
      data-testid="register-delete-confirm"
      :title="t('projects.governance.confirmDeleteNamed', { name: confirmItem.title })"
      :confirm-label="t('projects.governance.confirmDeleteAction')"
      :pending="remove.isPending.value"
      @cancel="cancelDelete"
      @confirm="deleteItem(confirmItem)"
    >
      <p v-if="error" class="text-error">{{ error }}</p>
    </SharedInlineConfirm>
    <p v-else-if="error" role="alert" class="text-sm text-error">{{ error }}</p>

    <SharedPageState v-if="list.error.value" :error="list.error.value" @retry="list.refetch" />
    <SharedEmptyState v-else-if="!list.isLoading.value && !list.data.value?.items.length" :title="t(activeFilterCount ? 'projects.clarity.filteredEmpty' : 'projects.clarity.registerEmpty')" />
    <SharedDataTable v-else :rows="list.data.value?.items ?? []" :columns="columns" row-key="id" :row-to="itemTo" :loading="list.isLoading.value" :caption="t('projects.refresh.workspace.registerTitle')">
      <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
      <template #title-cell="{ row }">
        <NuxtLink :to="itemTo(row.original)" @click="openLiveItem($event, row.original)" class="font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.title }}</NuxtLink>
      </template>
      <template #kind-cell="{ row }">{{ t(`projects.governance.register.${row.original.kind}`) }}</template>
      <template #priority-cell="{ row }"><SharedStatusBadge :tone="REGISTER_PRIORITY_TONE[row.original.priority]" :label="t(`projects.governance.register.${row.original.priority}`)" /></template>
      <template #status-cell="{ row }"><SharedStatusBadge :tone="REGISTER_STATUS_TONE[row.original.status]" :label="t(`projects.governance.register.${row.original.status}`)" /></template>
      <template #score-cell="{ row }"><SharedStatusBadge :tone="registerScoreTone(row.original.score)" :label="String(row.original.score ?? '—')" /></template>
      <template #actions-cell="{ row }">
        <div v-if="list.data.value?.can_manage" class="flex justify-end">
          <SharedRowActions :actions="rowActions(row.original)" :label="t('projects.governance.actionsNamed', { name: row.original.title })" :disabled="!hydrated" />
        </div>
      </template>
      <template #mobile-row="{ row: item }">
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <RecordNumber :value="item.id" />
              <NuxtLink :to="itemTo(item)" @click="openLiveItem($event, item)" class="block font-medium text-highlighted hover:underline">{{ item.title }}</NuxtLink>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <SharedStatusBadge :tone="REGISTER_STATUS_TONE[item.status]" :label="t(`projects.governance.register.${item.status}`)" />
              <SharedRowActions v-if="list.data.value?.can_manage" :actions="rowActions(item)" :label="t('projects.governance.actionsNamed', { name: item.title })" :disabled="!hydrated" />
            </div>
          </div>
          <dl class="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
            <div><dt class="text-xs text-muted">{{ t('projects.governance.register.kind') }}</dt><dd>{{ t(`projects.governance.register.${item.kind}`) }}</dd></div>
            <div><dt class="text-xs text-muted">{{ t('projects.governance.register.priority') }}</dt><dd><SharedStatusBadge :tone="REGISTER_PRIORITY_TONE[item.priority]" :label="t(`projects.governance.register.${item.priority}`)" /></dd></div>
            <div><dt class="text-xs text-muted">{{ t('projects.clarity.riskScore') }}</dt><dd><SharedStatusBadge :tone="registerScoreTone(item.score)" :label="String(item.score ?? '—')" /></dd></div>
          </dl>
        </div>
      </template>
    </SharedDataTable>
    <SharedPagination v-if="list.data.value" :page="pageNumber" :pages="pages" :disabled="list.isFetching.value" @update:page="setPage" />
  </SharedListPage>
  <NuxtPage />
</template>
