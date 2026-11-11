<script setup lang="ts">
import EmployeeSearchSelect from '@/components/hr/EmployeeSearchSelect.vue'
import EquipmentTable from '@/components/hr/assets/EquipmentTable.vue'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import {
  HR_ASSETS_PAGE_SIZE,
  type HrEquipment,
  type HrEquipmentActiveFilter,
  type HrEquipmentAssignedFilter,
} from '@/composables/useHrAssets'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const LIMIT = HR_ASSETS_PAGE_SIZE
// The equipment list is this page's own screen and stays behind its create panel; the
// categories list and an asset record are full pages of their own.
const isListRoute = computed(() => {
  const path = route.path.replace(/\/+$/, '') || '/'
  return path === '/hr/assets' || path === '/hr/assets/new'
})
const canManage = computed(() => can('hr.assets.manage'))
const canReadEmployees = computed(() => can('hr.employees.read'))

const ASSIGNED_FILTERS = ['all', 'true', 'false'] as const
const ACTIVE_FILTERS: HrEquipmentActiveFilter[] = ['true', 'false', 'all']

function positiveParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
function assignedParam(value: unknown): 'all' | HrEquipmentAssignedFilter {
  const raw = Array.isArray(value) ? value[0] : value
  return ASSIGNED_FILTERS.find(candidate => candidate === raw) ?? 'all'
}
function activeParam(value: unknown): HrEquipmentActiveFilter {
  const raw = Array.isArray(value) ? value[0] : value
  return ACTIVE_FILTERS.find(candidate => candidate === raw) ?? 'true'
}

const search = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))
const categoryId = computed(() => positiveParam(route.query.category_id))
const employeeId = computed(() => positiveParam(route.query.employee_id))
const assigned = computed(() => assignedParam(route.query.assigned))
const active = computed(() => activeParam(route.query.active))
const offset = computed(() => Math.max(0, Number(route.query.offset ?? 0) || 0))

const equipment = useHrEquipmentList(computed(() => ({
  q: search.value,
  categoryId: categoryId.value,
  employeeId: employeeId.value,
  assigned: assigned.value,
  active: active.value,
  limit: LIMIT,
  offset: offset.value,
})))
const categories = useHrAssetCategories()
// The holder filter searches employees; every assets role carries hr.employees.read through the
// catalog dependency. The chip names the chosen holder by id, wherever it sits in the directory.
const holder = useHrEmployee(computed(() => canReadEmployees.value ? employeeId.value : null))

const items = computed(() => equipment.data.value?.items ?? [])
const total = computed(() => equipment.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / LIMIT) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)))
const showEmpty = computed(() => !equipment.isLoading.value && !equipment.error.value && items.value.length === 0)
const activeFilterCount = computed(() => [
  search.value.trim(),
  categoryId.value,
  employeeId.value,
  assigned.value === 'all' ? null : assigned.value,
  active.value === 'true' ? null : active.value,
].filter(Boolean).length)

const categoryOptions = computed(() => (categories.data.value?.items ?? []).map(category => ({
  value: String(category.id),
  label: category.name,
})))
const categoryName = computed(() => categoryOptions.value.find(option => option.value === String(categoryId.value))?.label ?? t('hrAssets.columns.category'))
const employeeName = computed(() => holder.data.value?.name ?? t('hrAssets.columns.employee'))
const assignedOptions = computed(() => ASSIGNED_FILTERS.map(value => ({
  value,
  label: t(`hrAssets.assignedFilter.${value}`),
  testId: `hr-assets-assigned-${value}`,
})))
const activeOptions = computed(() => ACTIVE_FILTERS.map(value => ({
  value,
  label: t(`hrAssets.activeFilter.${value}`),
  testId: `hr-assets-active-${value}`,
})))

function writeQuery(patch: Partial<{
  q: string
  category: number | null
  employee: number | null
  assigned: 'all' | HrEquipmentAssignedFilter
  active: HrEquipmentActiveFilter
  offset: number
}>) {
  if (!hydrated.value) return
  const nextAssigned = patch.assigned ?? assigned.value
  const nextActive = patch.active ?? active.value
  void router.replace({
    query: {
      ...route.query,
      q: (patch.q ?? search.value).trim() || undefined,
      category_id: (patch.category !== undefined ? patch.category : categoryId.value) ?? undefined,
      employee_id: (patch.employee !== undefined ? patch.employee : employeeId.value) ?? undefined,
      assigned: nextAssigned === 'all' ? undefined : nextAssigned,
      active: nextActive === 'true' ? undefined : nextActive,
      offset: (patch.offset ?? 0) > 0 ? patch.offset : undefined,
    },
    hash: route.hash,
  })
}
function setPage(next: number) {
  if (!hydrated.value || equipment.isFetching.value || next < 1 || next > pages.value) return
  writeQuery({ offset: (next - 1) * LIMIT })
}
function clearFilters() {
  void router.replace({
    query: { ...route.query, q: undefined, category_id: undefined, employee_id: undefined, assigned: undefined, active: undefined, offset: undefined },
    hash: route.hash,
  })
}

const listQuery = computed(() => {
  const { returnTo: _referrer, ...context } = route.query
  return context
})
const createTo = computed(() => canManage.value ? { path: '/hr/assets/new', query: listQuery.value } : undefined)
const categoriesTo = computed(() => ({ path: '/hr/assets/categories' }))
function equipmentTo(row: HrEquipment) {
  return { path: `/hr/assets/${row.id}`, query: returnToQuery(route.fullPath) }
}
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    :title="t('nav.assets')"
    :create-to="createTo"
    :create-label="t('hrAssets.new')"
    create-test-id="hr-asset-new"
  >
    <template #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-tags" :to="categoriesTo" :disabled="!hydrated" :label="t('hrAssets.categories.title')" data-testid="hr-asset-categories" />
    </template>

    <SharedListCard>
      <template #filters>
        <SharedFilterBar inline class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput
              :model-value="search"
              icon="i-lucide-search"
              :disabled="!hydrated"
              :aria-label="t('hrAssets.search')"
              :placeholder="t('hrAssets.search')"
              data-testid="hr-assets-search"
              @update:model-value="writeQuery({ q: String($event ?? ''), offset: 0 })"
            />
          </template>
          <SharedFilterPopover :count="(categoryId ? 1 : 0) + (employeeId ? 1 : 0)" :disabled="!hydrated">
            <SharedFilterField :label="t('hrAssets.columns.category')" for="hr-assets-category">
              <USelect
                id="hr-assets-category"
                class="w-full"
                :model-value="categoryId ? String(categoryId) : undefined"
                :items="categoryOptions"
                :placeholder="t('hrAssets.anyCategory')"
                :disabled="!hydrated || categories.isLoading.value"
                data-testid="hr-assets-category"
                @update:model-value="writeQuery({ category: $event ? Number($event) : null, offset: 0 })"
              />
            </SharedFilterField>
            <SharedFilterField v-if="canReadEmployees" :label="t('hrAssets.columns.employee')" for="hr-assets-employee">
              <EmployeeSearchSelect
                id="hr-assets-employee"
                :model-value="employeeId"
                :any-label="t('hrAssets.anyEmployee')"
                :placeholder="t('hrAssets.anyEmployee')"
                :disabled="!hydrated"
                test-id="hr-assets-employee"
                @update:model-value="writeQuery({ employee: $event, offset: 0 })"
              />
            </SharedFilterField>
          </SharedFilterPopover>
          <div class="max-w-full overflow-x-auto">
            <SharedSegmentedControl
              :model-value="active"
              :items="activeOptions"
              :label="t('hrAssets.filter.active')"
              :disabled="!hydrated"
              @update:model-value="writeQuery({ active: activeParam($event), offset: 0 })"
            />
          </div>
          <div class="max-w-full overflow-x-auto">
            <SharedSegmentedControl
              :model-value="assigned"
              :items="assignedOptions"
              :label="t('hrAssets.filter.custody')"
              :disabled="!hydrated"
              @update:model-value="writeQuery({ assigned: assignedParam($event), offset: 0 })"
            />
          </div>
          <template #active>
            <SharedFilterChip v-if="categoryId" :label="categoryName" @remove="writeQuery({ category: null, offset: 0 })" />
            <SharedFilterChip v-if="employeeId" :label="employeeName" @remove="writeQuery({ employee: null, offset: 0 })" />
          </template>
        </SharedFilterBar>
      </template>

      <SharedPageState :error="equipment.error.value" :keep-content="items.length > 0" @retry="equipment.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t('hrAssets.emptyTitle')" :description="t('hrAssets.emptyHint')" />
        <EquipmentTable v-else :equipment="items" :row-to="equipmentTo" :loading="equipment.isLoading.value" :caption="t('hrAssets.title')" />
      </SharedPageState>
      <template v-if="equipment.data.value && !showEmpty" #footer>
        <SharedListFooter
          :count-label="t('hrAssets.footer', { shown: items.length, total }, total)"
          :page="page"
          :pages="pages"
          :disabled="equipment.isFetching.value"
          count-test-id="hr-assets-count"
          @update:page="setPage"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
