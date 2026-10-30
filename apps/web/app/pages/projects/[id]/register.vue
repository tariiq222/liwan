<script setup lang="ts">
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { useProjectRegister, useDeleteProjectRegister } from '@/composables/useProjectGovernance'
import { governanceFilters } from '@/composables/projectGovernanceKeys'
import { useGovernancePaging } from '@/components/pmo/projects/governance/listPaging'
import { REGISTER_PRIORITY_TONE, REGISTER_STATUS_TONE, registerScoreTone } from '@/components/pmo/projects/governance/state'
import { ApiError } from '@/composables/useApi'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import { useProjectMissing } from '@/composables/useProjects'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/projects\/[^/]+\/register/, '')
  return rest === '' || rest === '/new'
})
const id = computed(() => Number(route.params.id))
const notFound = useProjectMissing(id)
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
const { pageNumber, pages, setPage } = useGovernancePaging(list, computed(() => parsed.value.offset ?? 0), isListRoute, { route, router, hydrated })
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
  { value: 'in_progress', label: t('projects.governance.register.in_progress') },
  { value: 'resolved', label: t('projects.governance.register.resolved') },
  { value: 'closed', label: t('projects.governance.register.closed') },
])
const priorityItems = computed(() => [
  { value: 'all', label: t('projects.clarity.allPriorities') },
  ...['low', 'normal', 'high', 'critical'].map(value => ({ value, label: t(`projects.governance.register.${value}`) })),
])
const KIND_ICON = { risk: 'i-lucide-triangle-alert', issue: 'i-lucide-circle-alert' } as const
const columns = computed(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t), meta: { class: { th: 'w-12 px-2', td: 'w-12 px-2' } } },
  { accessorKey: 'title', header: t('projects.governance.register.itemTitle'), meta: { class: { th: 'min-w-56', td: 'max-w-0 min-w-56 truncate' } } },
  { accessorKey: 'kind', header: t('projects.governance.register.kind'), meta: { class: { th: 'w-28', td: 'w-28' } } },
  { accessorKey: 'priority', header: t('projects.governance.register.priority'), meta: { class: { th: 'w-28', td: 'w-28' } } },
  { accessorKey: 'status', header: t('projects.governance.register.status'), meta: { class: { th: 'w-36', td: 'w-36' } } },
  { accessorKey: 'score', header: t('projects.clarity.riskScore'), meta: { class: { th: 'w-24', td: 'w-24' } } },
  { id: 'owner', header: t('projects.governance.register.owner'), meta: { class: { th: 'w-28', td: 'w-28' } } },
  { id: 'actions', header: t('app.actions'), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } },
])
const total = computed(() => list.data.value?.total ?? 0)
const items = computed(() => list.data.value?.items ?? [])
// Nothing registered and nothing filtered is an empty page, not an empty list: no filter row to show.
const bareEmpty = computed(() => Boolean(list.data.value) && !items.value.length && !activeFilterCount.value && !parsed.value.offset)
async function deleteItem(item: { id: number }) {
  error.value = null
  if (confirmDeleteId.value !== item.id) {
    confirmDeleteId.value = item.id
    return
  }
  try {
    await remove.mutateAsync({ projectId: id.value, id: item.id })
    confirmDeleteId.value = null
    toast.add({ title: t('projects.toast.registerDeleted'), color: 'success' })
  }
  catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
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
  <ProjectNotFoundState v-if="isListRoute && notFound" />
  <SharedListPage
    v-else-if="isListRoute"
    hide-header
    :title="t('projects.refresh.workspace.registerTitle')"
    :create-to="createTo"
    :create-label="t('projects.clarity.addRegister')"
    create-test-id="register-create"
  >
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

    <SharedEmptyState v-if="bareEmpty" bordered :title="t('projects.clarity.registerEmpty')" />
    <SharedListCard v-else>
      <template #filters>
        <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput v-model="search" :aria-label="t('projects.clarity.registerSearch')" :disabled="!hydrated" :placeholder="t('projects.clarity.registerSearch')" icon="i-lucide-search" class="w-full min-w-52">
              <template v-if="search" #trailing>
                <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('projects.filters.clearSearch')" class="-me-1" @click="search = ''" />
              </template>
            </UInput>
          </template>
          <template #default>
            <USelect class="w-full md:w-44" icon="i-lucide-activity" :items="statusItems" :model-value="status" :disabled="!hydrated" :aria-label="t('projects.governance.register.status')" @update:model-value="setStatus" />
            <USelect class="w-full md:w-44" icon="i-lucide-flag" :items="priorityItems" :model-value="priority" :disabled="!hydrated" :aria-label="t('projects.governance.register.priority')" @update:model-value="setPriority" />
          </template>
          <template #view>
            <SharedSegmentedControl :label="t('projects.governance.register.kind')" :items="kindItems" :model-value="kind" :disabled="!hydrated" @update:model-value="setKind" />
          </template>
        </FilterBar>
      </template>
      <SharedPageState v-if="list.error.value" :error="list.error.value" @retry="list.refetch" />
      <div v-else-if="!list.isLoading.value && !items.length" class="p-(--webvue-card-pad)">
        <SharedEmptyState :title="t(activeFilterCount ? 'projects.clarity.filteredEmpty' : 'projects.clarity.registerEmpty')" />
      </div>
      <SharedDataTable v-else bare :rows="items" :columns="columns" row-key="id" :row-to="itemTo" :loading="list.isLoading.value" :caption="t('projects.refresh.workspace.registerTitle')">
        <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
        <template #title-cell="{ row }">
          <NuxtLink :to="itemTo(row.original)" @click="openLiveItem($event, row.original)" class="block truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.title }}</NuxtLink>
        </template>
        <template #kind-cell="{ row }"><SharedStatusBadge tone="neutral" :icon="KIND_ICON[row.original.kind]" :label="t(`projects.governance.register.${row.original.kind}`)" /></template>
        <template #priority-cell="{ row }"><SharedStatusBadge :tone="REGISTER_PRIORITY_TONE[row.original.priority]" :label="t(`projects.governance.register.${row.original.priority}`)" /></template>
        <template #status-cell="{ row }"><SharedStatusBadge :tone="REGISTER_STATUS_TONE[row.original.status]" :label="t(`projects.governance.register.${row.original.status}`)" /></template>
        <template #score-cell="{ row }">
          <SharedStatusBadge v-if="row.original.score != null" :tone="registerScoreTone(row.original.score)" :label="String(row.original.score)" />
          <span v-else class="text-muted">—</span>
        </template>
        <template #owner-cell="{ row }"><SharedPersonAvatar :people="row.original.owner ? [row.original.owner] : []" /></template>
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
                <NuxtLink :to="itemTo(item)" @click="openLiveItem($event, item)" class="block font-semibold text-highlighted hover:underline">{{ item.title }}</NuxtLink>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <SharedStatusBadge :tone="REGISTER_STATUS_TONE[item.status]" :label="t(`projects.governance.register.${item.status}`)" />
                <SharedRowActions v-if="list.data.value?.can_manage" :actions="rowActions(item)" :label="t('projects.governance.actionsNamed', { name: item.title })" :disabled="!hydrated" />
              </div>
            </div>
            <dl class="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <div><dt class="text-xs text-muted">{{ t('projects.governance.register.kind') }}</dt><dd>{{ t(`projects.governance.register.${item.kind}`) }}</dd></div>
              <div><dt class="text-xs text-muted">{{ t('projects.governance.register.priority') }}</dt><dd><SharedStatusBadge :tone="REGISTER_PRIORITY_TONE[item.priority]" :label="t(`projects.governance.register.${item.priority}`)" /></dd></div>
              <div><dt class="text-xs text-muted">{{ t('projects.clarity.riskScore') }}</dt><dd><SharedStatusBadge v-if="item.score != null" :tone="registerScoreTone(item.score)" :label="String(item.score)" /><span v-else class="text-muted">—</span></dd></div>
            </dl>
          </div>
        </template>
      </SharedDataTable>
      <template v-if="!list.error.value && items.length" #footer>
        <SharedListFooter :count-label="t('projects.footer.results', { shown: items.length, total }, total)" count-test-id="register-result-count" :page="pageNumber" :pages="pages" :disabled="list.isFetching.value" @update:page="setPage" />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
