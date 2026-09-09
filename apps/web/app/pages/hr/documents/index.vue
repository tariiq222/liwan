<script setup lang="ts">
import { Plus, Search } from '@lucide/vue'
import FilterBar from '@/components/shared/FilterBar.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import { useHrDocuments } from '@/composables/useHrDocuments'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { returnToQuery } from '@/utils/safeReturnTo'
import { refDebounced } from '@vueuse/core'
import { hasPendingHrSearch, hrCommittedListParams } from '@/composables/useHrSearch'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
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
const page = computed(() => Math.floor(committedListParams.value.offset / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
const selectedDepartment = computed(() => departments.data.value?.items.find(department => department.id === departmentId.value))
const hasActiveFilters = computed(() => Boolean(search.value.trim() || departmentId.value))
const activeFilterCount = computed(() => Number(Boolean(search.value.trim())) + Number(Boolean(departmentId.value)))

watch(() => [route.query.q, route.query.department_id, route.query.offset], ([q, department, nextOffset]) => {
  search.value = String(q ?? '')
  departmentId.value = department ? Number(department) : undefined
  offset.value = Math.max(0, Number(nextOffset ?? 0) || 0)
})
watch(debouncedSearch, (value) => {
  if (value !== String(route.query.q ?? '')) updateFilters()
})

function updateFilters() {
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
function clearFilters() {
  search.value = ''
  departmentId.value = undefined
  updateFilters()
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || hasPendingSearch.value || next < 1 || next > pages.value) return
  offset.value = (next - 1) * limit
  void router.replace({ query: { ...route.query, offset: offset.value > 0 ? offset.value : undefined } })
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('hr.docs.title')" :back-to="'/hr'">
      <template #actions>
        <NuxtLink
          v-if="can('hr.documents.manage')"
          :to="{ path: '/hr/documents/new', query: { ...returnToQuery(route.fullPath), department_id: departmentId } }"
        >
          <Button :disabled="!hydrated" class="gap-2">
            <Plus class="size-[18px]" />{{ t('hr.docs.new') }}
          </Button>
        </NuxtLink>
      </template>
    </SharedPageHeader>
    <div class="w-full min-w-0" data-testid="documents-toolbar">
      <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
        <template #search>
          <div class="relative min-w-52">
            <Search class="pointer-events-none absolute start-2 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input
              v-model="search"
              :disabled="!hydrated"
              :placeholder="t('hr.docs.search')"
              :aria-label="t('hr.docs.search')"
              class="ps-8"
              @change="updateFilters"
            />
          </div>
        </template>
        <template #default>
          <Select
            v-if="can('hr.departments.read')"
            :model-value="departmentId ? String(departmentId) : 'all'"
            @update:model-value="onDepartmentChange"
          >
            <SelectTrigger class="w-48" :disabled="!hydrated" :aria-label="t('hr.docs.allDepartments')">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{{ t('hr.docs.allDepartments') }}</SelectItem>
              <SelectItem v-for="department in departments.data.value?.items ?? []" :key="department.id" :value="String(department.id)">
                {{ department.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </template>
        <template #active>
          <div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-2">
            <Badge v-if="search.trim()" variant="secondary">{{ t('hr.directory.searchValue', { value: search }) }}</Badge>
            <Badge v-if="selectedDepartment" variant="secondary">{{ selectedDepartment.name }}</Badge>
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
      <div class="nasq-panel overflow-hidden">
        <div class="overflow-x-auto">
          <Table class="min-w-[520px]">
          <TableHeader>
            <TableRow>
              <TableHead class="w-28 text-start">{{ t('app.recordNumber') }}</TableHead>
              <TableHead class="text-start">{{ t('hr.docs.columns.name') }}</TableHead>
              <TableHead class="text-start">{{ t('hr.docs.columns.department') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="document in query.data.value?.items"
              :key="document.id"
              class="cursor-pointer transition-colors hover:bg-muted/30"
              @click="navigateTo({ path: `/hr/departments/${document.department.id}/documents/${document.id}`, query: returnToQuery(route.fullPath) })"
            >
              <TableCell class="w-28"><RecordNumber :value="document.id" /></TableCell>
              <TableCell class="font-medium">{{ document.name }}</TableCell>
              <TableCell class="text-muted-foreground">{{ document.department.name }}</TableCell>
            </TableRow>
          </TableBody>
          </Table>
        </div>
      </div>
    </SharedPageState>
    <div v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
      <Button variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" @click="setPage(page - 1)">
        {{ t('access.previousPage') }}
      </Button>
      <span>{{ t('access.pageOf', { page, pages }) }}</span>
      <Button variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" @click="setPage(page + 1)">
        {{ t('access.nextPage') }}
      </Button>
    </div>
  </SharedPageContainer>
</template>
