<script setup lang="ts">
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import FilterBar from '@liwan/ui/app/components/shared/data/FilterBar.vue'
import { useProjectStakeholders, useDeleteProjectStakeholder } from '@/composables/useProjectGovernance'
import { useGovernanceListPage } from '@/components/pmo/projects/governance/listPage'
import { ApiError } from '@/composables/useApi'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import { useProjectMissing } from '@/composables/useProjects'
import RecordNumber from '@liwan/ui/app/components/shared/data/RecordNumber.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const remove = useDeleteProjectStakeholder()
const {
  isListRoute, id, parsed, list, search, pageNumber, pages, setPage, itemTo, createTo, openLiveItem,
  error, confirmItem, deleteItem, rowActions, cancelDelete,
} = useGovernanceListPage({
  section: 'stakeholders',
  useList: (projectId, filters) => useProjectStakeholders(projectId, computed(() => ({ q: filters.value.q, limit: 50, offset: filters.value.offset }))),
  remove,
  deletedTitle: t('projects.toast.stakeholderDeleted'),
  deleteLabel: t('projects.governance.delete'),
  confirmTestId: 'stakeholder-delete-confirm',
  deleteError: cause => cause instanceof ApiError && cause.code === 'stakeholder_assigned'
    ? t('projects.governance.stakeholderAssigned')
    : cause instanceof ApiError ? cause.message : t('errors.generic'),
  context: { route, router, hydrated, toast },
})
const notFound = useProjectMissing(id)
const activeFilterCount = computed(() => Number(Boolean(search.value.trim())))
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
      <div v-else-if="!list.isLoading.value && !items.length" class="p-(--liwan-card-pad)">
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
