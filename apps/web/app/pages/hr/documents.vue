<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import FilterBar from '@/components/shared/FilterBar.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import { useHrDocuments, type HrDocument } from '@/composables/useHrDocuments'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { returnToQuery } from '@/utils/safeReturnTo'
import { refDebounced } from '@vueuse/core'
import { hasPendingHrSearch, hrCommittedListParams } from '@/composables/useHrSearch'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/hr\/documents/, '')
  return rest === '' || rest === '/new'
})
const search = ref(String(route.query.q ?? ''))
const debouncedSearch = refDebounced(search, 250)
const hasPendingSearch = computed(() => hasPendingHrSearch(search.value, route.query.q))
const committedListParams = computed(() => hrCommittedListParams(route.query))
const departmentId = ref(route.query.department_id ? Number(route.query.department_id) : undefined)
const limit = 25
const offset = ref(Math.max(0, Number(route.query.offset ?? 0) || 0))
const params = computed(() => {
  const query = route.query
  const department = typeof query.department_id === 'string' ? Number(query.department_id) : NaN
  return {
    ...hrCommittedListParams(query),
    department_id: Number.isSafeInteger(department) && department > 0 ? department : undefined,
    limit,
  }
})
const query = useHrDocuments(params)
const departments = useHrDepartments()
const departmentOptions = computed(() => [{ value: 'all', label: t('hr.docs.allDepartments') }, ...(departments.data.value?.items ?? []).map(department => ({ value: String(department.id), label: department.name }))])
const page = computed(() => Math.floor(committedListParams.value.offset / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
const selectedDepartment = computed(() => departments.data.value?.items.find(department => department.id === departmentId.value))
const hasActiveFilters = computed(() => Boolean(search.value.trim() || departmentId.value))
const activeFilterCount = computed(() => Number(Boolean(search.value.trim())) + Number(Boolean(departmentId.value)))

const columns = computed<TableColumn<HrDocument>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('hr.docs.columns.name') },
  { accessorKey: 'department', header: t('hr.docs.columns.department') },
])

watch(() => [route.query.q, route.query.department_id, route.query.offset], ([q, department, nextOffset]) => {
  search.value = String(q ?? '')
  departmentId.value = department ? Number(department) : undefined
  offset.value = Math.max(0, Number(nextOffset ?? 0) || 0)
})
watch(debouncedSearch, (value) => {
  if (value !== String(route.query.q ?? '')) updateFilters()
})

function updateFilters() {
  if (normalizedPath.value !== '/hr/documents') return
  offset.value = 0
  void router.replace({
    query: {
      ...route.query,
      q: search.value.trim() || undefined,
      department_id: departmentId.value ?? undefined,
      offset: undefined,
    },
  })
}
function onDepartmentChange(value: unknown) {
  departmentId.value = value && value !== 'all' ? Number(value) : undefined
  updateFilters()
}
function clearSearch() {
  search.value = ''
  updateFilters()
}
function clearFilters() {
  search.value = ''
  departmentId.value = undefined
  updateFilters()
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || hasPendingSearch.value || next < 1 || next > pages.value) return
  if (normalizedPath.value !== '/hr/documents') return
  offset.value = (next - 1) * limit
  void router.replace({ query: { ...route.query, offset: offset.value > 0 ? offset.value : undefined } })
}
function openRow(event: Event, document: HrDocument) {
  if (!hydrated.value || (event.target as HTMLElement | null)?.closest('a, button')) return
  void navigateTo(documentTo(document))
}
function documentTo(document: HrDocument) {
  return { path: `/hr/departments/${document.department.id}/documents/${document.id}`, query: returnToQuery(route.fullPath) }
}
</script>

<template>
  <SharedPageContainer v-if="isListRoute" width="list">
    <SharedPageHeader :title="t('nav.documents')" />
    <div class="w-full min-w-0" data-testid="documents-toolbar">
      <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
        <template #search>
          <UInput
            v-model="search"
            :disabled="!hydrated"
            :placeholder="t('hr.docs.search')"
            :aria-label="t('hr.docs.search')"
            icon="i-lucide-search"
            class="min-w-52"
            @change="updateFilters"
          />
        </template>
        <template v-if="can('hr.departments.read')" #default>
          <SharedFilterField :label="t('hr.docs.department')" for="hr-documents-department">
            <USelect
              id="hr-documents-department"
              :model-value="departmentId ? String(departmentId) : 'all'"
              :items="departmentOptions"
              class="w-full"
              :disabled="!hydrated"
              @update:model-value="onDepartmentChange"
            />
          </SharedFilterField>
        </template>
        <template #active>
          <div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-2">
            <SharedFilterChip v-if="search.trim()" :label="t('hr.directory.searchValue', { value: search })" @remove="clearSearch" />
            <SharedFilterChip v-if="selectedDepartment" :label="selectedDepartment.name" @remove="onDepartmentChange('all')" />
          </div>
        </template>
      </FilterBar>
    </div>
    <SharedPageState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="!query.data.value?.items.length"
      :empty-text="t('hr.docs.empty')"
      @retry="query.refetch"
    >
      <div class="min-w-0 space-y-2">
        <div class="hidden overflow-hidden rounded-lg bg-default ring ring-default md:block">
          <div class="overflow-x-auto">
            <UTable :data="query.data.value?.items ?? []" :columns="columns" :caption="t('hr.docs.title')" :ui="{ caption: 'sr-only', th: '', tr: 'cursor-pointer' }" @select="(event, row) => openRow(event, row.original)">
              <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
              <template #name-cell="{ row }"><NuxtLink :to="documentTo(row.original)" class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.name }}</NuxtLink></template>
              <template #department-cell="{ row }"><span class="text-muted">{{ row.original.department.name }}</span></template>
            </UTable>
          </div>
        </div>
        <ul class="divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default md:hidden" :aria-label="t('hr.docs.title')">
          <li v-for="document in query.data.value?.items ?? []" :key="document.id" class="cursor-pointer p-4" @click="openRow($event, document)">
            <bdi class="block text-xs text-muted">#{{ document.id }}</bdi>
            <NuxtLink :to="documentTo(document)" class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ document.name }}</NuxtLink>
            <p class="mt-1 text-xs text-muted">{{ document.department.name }}</p>
          </li>
        </ul>
      </div>
    </SharedPageState>
    <SharedPagination class="mt-4" :page="page" :pages="pages" :disabled="query.isFetching.value" @update:page="setPage" />
  </SharedPageContainer>
  <NuxtPage />
</template>
