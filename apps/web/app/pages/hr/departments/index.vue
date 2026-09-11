<script setup lang="ts">
import DepartmentOrgChart from '@/components/hr/DepartmentOrgChart.vue'
import DepartmentTable from '@/components/hr/DepartmentTable.vue'
import DepartmentTree from '@/components/hr/DepartmentTree.vue'
import FilterBar from '@/components/shared/FilterBar.vue'
import { buildDepartmentTree } from '@/lib/departmentTree'
import { ApiError } from '@/composables/useApi'
import { useDeleteHrDepartment, useHrDepartments, type HrDepartment } from '@/composables/useHrDepartments'
import { returnToQuery } from '@/utils/safeReturnTo'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const query = useHrDepartments()
const hydrated = useHydrated()
const toast = useToast()
const search = computed({ get: () => typeof route.query.q === 'string' ? route.query.q : '', set: q => { void router.replace({ query: { ...route.query, q: q || undefined } }) } })
const treeView = computed(() => route.query.view === 'tree')
const canvasView = computed(() => route.query.view === 'canvas')
const departments = computed(() => query.data.value?.items ?? [])
const roots = computed(() => buildDepartmentTree(departments.value))
const filtered = computed(() => departments.value.filter(d => `${d.name} ${d.manager?.name ?? ''}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))
const activeFilterCount = computed(() => Number(Boolean(search.value.trim())))
const deleting = ref<HrDepartment | null>(null)
const deleteError = ref<ApiError | null>(null)
const { mutateAsync: deleteDepartment, isPending: deletingPending } = useDeleteHrDepartment()
function openDepartment(id: number) { void navigateTo({ path: `/hr/departments/${id}`, query: returnToQuery(route.fullPath) }) }
function editDepartment(id: number) { void navigateTo({ path: `/hr/departments/${id}/edit`, query: returnToQuery(route.fullPath) }) }
function createChild(id: number) { void navigateTo({ path: '/hr/departments/new', query: { ...returnToQuery(route.fullPath), parent_id: id } }) }
function setView(tree: boolean) { void router.replace({ query: { ...route.query, view: tree ? 'tree' : undefined } }) }
function setCanvasView() { void router.replace({ query: { ...route.query, view: 'canvas' } }) }
function clearFilters() { search.value = '' }
function askDelete(department: HrDepartment) { deleting.value = department; deleteError.value = null }
async function confirmDelete() {
  if (!deleting.value || !hydrated.value || deletingPending.value || !can('hr.departments.manage')) return
  try { await deleteDepartment(deleting.value.id); deleting.value = null; toast.add({ title: t('hr.depts.deleted'), color: 'success' }) }
  catch (error) { deleteError.value = error instanceof ApiError ? error : new ApiError(500, 'http_error', t('errors.generic')) }
}
</script>
<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('nav.departments')" />
    <div class="w-full min-w-0">
      <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
        <template #search>
          <UInput v-model="search" class="min-w-52 flex-1" :disabled="!hydrated" :aria-label="t('hr.depts.search')" :placeholder="t('hr.depts.search')" icon="i-lucide-search" />
        </template>
        <template #view>
          <div role="group" class="nasq-ui-segment" :aria-label="t('hr.depts.title')">
            <UButton type="button" :color="!treeView && !canvasView ? 'primary' : 'secondary'" :variant="!treeView && !canvasView ? 'soft' : 'ghost'" square :disabled="!hydrated" :aria-label="t('hr.depts.listView')" :aria-pressed="!treeView && !canvasView" icon="i-lucide-list" data-testid="hr-departments-view-list" @click="setView(false)" />
            <UButton type="button" :color="treeView ? 'primary' : 'secondary'" :variant="treeView ? 'soft' : 'ghost'" square :disabled="!hydrated" :aria-label="t('hr.depts.hierarchy')" :aria-pressed="treeView" icon="i-lucide-network" data-testid="hr-departments-view-tree" @click="setView(true)" />
            <UButton type="button" :color="canvasView ? 'primary' : 'secondary'" :variant="canvasView ? 'soft' : 'ghost'" square :disabled="!hydrated" :aria-label="t('hr.depts.orgChart')" :aria-pressed="canvasView" icon="i-lucide-scan" data-testid="hr-departments-view-canvas" @click="setCanvasView" />
          </div>
        </template>
        <template #active>
          <div v-if="search.trim()" class="flex flex-wrap items-center gap-2">
            <UBadge color="neutral" variant="subtle">{{ t('hr.directory.searchValue', { value: search }) }}</UBadge>
          </div>
        </template>
      </FilterBar>
    </div>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!departments.length" @retry="query.refetch">
      <DepartmentOrgChart v-if="canvasView" :roots="roots" :query="search" :hydrated="hydrated" :return-to="route.fullPath" />
      <DepartmentTree v-else-if="treeView" :roots="roots" :query="search" :hydrated="hydrated" :can-manage="can('hr.departments.manage')" :can-read-employees="can('hr.employees.read')" :can-read-documents="can('hr.documents.read')" @select="openDepartment" @edit="editDepartment" @create-child="createChild" />
      <DepartmentTable v-else :departments="filtered" :can-manage="can('hr.departments.manage')" @select="openDepartment" @delete="askDelete" />
    </SharedPageState>
    <UAlert v-if="deleting" role="alert" color="error" variant="subtle" :title="t('hr.depts.deleteConfirm', { name: deleting.name })" :description="deleteError?.message">
      <template #actions>
        <UButton color="neutral" variant="outline" :disabled="deletingPending" :label="t('app.cancel')" @click="deleting = null" />
        <UButton color="error" :disabled="!hydrated || deletingPending" :label="t('hr.depts.delete')" @click="confirmDelete" />
      </template>
    </UAlert>
  </SharedPageContainer>
</template>
