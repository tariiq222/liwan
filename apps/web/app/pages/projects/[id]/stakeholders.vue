<script setup lang="ts">
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import { useProjectStakeholders, useDeleteProjectStakeholder } from '@/composables/useProjectGovernance'
import { governanceFilters } from '@/composables/projectGovernanceKeys'
import { ApiError } from '@/composables/useApi'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import { useProjectMissing } from '@/composables/useProjects'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/projects\/[^/]+\/stakeholders/, '')
  return rest === '' || rest === '/new'
})
const id = computed(() => Number(route.params.id))
const notFound = useProjectMissing(id)
const parsed = computed(() => governanceFilters(route.query))
const filters = computed(() => ({ q: parsed.value.q, limit: 50, offset: parsed.value.offset }))
const list = useProjectStakeholders(computed(() => isListRoute.value ? id.value : null), filters)
const remove = useDeleteProjectStakeholder()
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
const itemTo = (item: { id: number }) => ({ path: `/projects/${id.value}/stakeholders/${item.id}`, query: liveQuery.value })
const createTo = computed(() => list.data.value?.can_manage ? { path: `/projects/${id.value}/stakeholders/new`, query: liveQuery.value } : undefined)
const activeFilterCount = computed(() => Number(Boolean(q.value.trim())))
function clearFilters() {
  router.replace({ query: { ...route.query, q: undefined, offset: undefined } })
}

const columns = computed(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t), meta: { class: { th: 'w-12 px-2', td: 'w-12 px-2' } } },
  { accessorKey: 'name', header: t('projects.governance.stakeholder.name'), meta: { class: { th: 'min-w-56', td: 'max-w-0 min-w-56 truncate' } } },
  { accessorKey: 'organization', header: t('projects.governance.stakeholder.organization'), meta: { class: { td: 'max-w-0 min-w-40 truncate' } } },
  { accessorKey: 'role', header: t('projects.governance.stakeholder.role'), meta: { class: { td: 'max-w-0 min-w-40 truncate' } } },
  { id: 'user', header: t('projects.governance.stakeholder.internalUser'), meta: { class: { th: 'w-36', td: 'w-36' } } },
  { id: 'actions', header: t('app.actions'), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } },
])
const total = computed(() => list.data.value?.total ?? 0)
const items = computed(() => list.data.value?.items ?? [])
// Nobody registered and nothing searched is an empty page, not an empty list: no filter row to show.
const bareEmpty = computed(() => Boolean(list.data.value) && !items.value.length && !activeFilterCount.value && !parsed.value.offset)
async function deleteItem(item: { id: number }) {
  error.value = null
  if (confirmDeleteId.value !== item.id) { confirmDeleteId.value = item.id; return }
  try {
    await remove.mutateAsync({ projectId: id.value, id: item.id })
    confirmDeleteId.value = null
    toast.add({ title: t('projects.toast.stakeholderDeleted'), color: 'success' })
  }
  catch (cause) {
    error.value = cause instanceof ApiError && cause.code === 'stakeholder_assigned'
      ? t('projects.governance.stakeholderAssigned')
      : cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}
const confirmItem = computed(() => list.data.value?.items.find(item => item.id === confirmDeleteId.value) ?? null)
// The row menu only opens the confirmation; deletion happens from SharedInlineConfirm.
function rowActions(item: { id: number; name: string }): RowAction[] {
  return [{
    label: t('projects.governance.delete'),
    icon: 'i-lucide-trash-2',
    destructive: true,
    disabled: remove.isPending.value,
    onSelect: () => {
      if (confirmDeleteId.value === item.id) return
      void deleteItem(item)
      void nextTick(() => document.querySelector('[data-testid="stakeholder-delete-confirm"]')?.scrollIntoView({ block: 'nearest' }))
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
    :title="t('nav.projectStakeholders')"
    :create-to="createTo"
    :create-label="t('projects.governance.newStakeholder')"
    create-test-id="stakeholders-create"
  >
    <SharedInlineConfirm
      v-if="confirmItem"
      data-testid="stakeholder-delete-confirm"
      :title="t('projects.governance.confirmDeleteNamed', { name: confirmItem.name })"
      :confirm-label="t('projects.governance.confirmDeleteAction')"
      :pending="remove.isPending.value"
      @cancel="cancelDelete"
      @confirm="deleteItem(confirmItem)"
    >
      <p v-if="error" class="text-error">{{ error }}</p>
    </SharedInlineConfirm>
    <p v-else-if="error" role="alert" class="text-sm text-error">{{ error }}</p>

    <SharedEmptyState v-if="bareEmpty" bordered :title="t('projects.clarity.stakeholdersEmpty')" />
    <SharedListCard v-else>
      <template #filters>
        <div class="w-full min-w-0" data-testid="stakeholders-toolbar">
          <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
            <template #search>
              <UInput v-model="search" :aria-label="t('projects.clarity.stakeholderSearch')" :disabled="!hydrated" :placeholder="t('projects.clarity.stakeholderSearch')" icon="i-lucide-search" class="w-full min-w-52">
                <template v-if="search" #trailing>
                  <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('projects.filters.clearSearch')" class="-me-1" @click="clearFilters" />
                </template>
              </UInput>
            </template>
          </FilterBar>
        </div>
      </template>
      <SharedPageState v-if="list.error.value" :error="list.error.value" @retry="list.refetch" />
      <div v-else-if="!list.isLoading.value && !items.length" class="p-(--webvue-card-pad)">
        <SharedEmptyState :title="t(activeFilterCount ? 'projects.clarity.filteredEmpty' : 'projects.clarity.stakeholdersEmpty')" />
      </div>
      <SharedDataTable v-else bare :rows="items" :columns="columns" row-key="id" :row-to="itemTo" :loading="list.isLoading.value" :caption="t('projects.governance.stakeholders')">
        <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
        <template #name-cell="{ row }">
          <NuxtLink :to="itemTo(row.original)" @click="openLiveItem($event, row.original)" class="block truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.name }}</NuxtLink>
        </template>
        <template #organization-cell="{ row }"><span :title="row.original.organization">{{ row.original.organization || '—' }}</span></template>
        <template #role-cell="{ row }"><span :title="row.original.role">{{ row.original.role || '—' }}</span></template>
        <template #user-cell="{ row }"><SharedPersonAvatar :people="row.original.user ? [row.original.user] : []" /></template>
        <template #actions-cell="{ row }">
          <div v-if="list.data.value?.can_manage" class="flex justify-end">
            <SharedRowActions :actions="rowActions(row.original)" :label="t('projects.governance.actionsNamed', { name: row.original.name })" :disabled="!hydrated" />
          </div>
        </template>
        <template #mobile-row="{ row: item }">
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 space-y-1">
                <RecordNumber :value="item.id" />
                <NuxtLink :to="itemTo(item)" @click="openLiveItem($event, item)" class="block font-semibold text-highlighted hover:underline">{{ item.name }}</NuxtLink>
              </div>
              <SharedRowActions v-if="list.data.value?.can_manage" :actions="rowActions(item)" :label="t('projects.governance.actionsNamed', { name: item.name })" :disabled="!hydrated" />
            </div>
            <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div><dt class="text-xs text-muted">{{ t('projects.governance.stakeholder.organization') }}</dt><dd>{{ item.organization || '—' }}</dd></div>
              <div><dt class="text-xs text-muted">{{ t('projects.governance.stakeholder.role') }}</dt><dd>{{ item.role || '—' }}</dd></div>
            </dl>
          </div>
        </template>
      </SharedDataTable>
      <template v-if="!list.error.value && items.length" #footer>
        <SharedListFooter :count-label="t('projects.footer.results', { shown: items.length, total }, total)" count-test-id="stakeholders-result-count" :page="pageNumber" :pages="pages" :disabled="list.isFetching.value" @update:page="setPage" />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
