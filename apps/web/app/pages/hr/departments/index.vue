<script setup lang="ts">
import { List, Network, Scan, Search } from '@lucide/vue'
import DepartmentOrgChart from '@/components/hr/DepartmentOrgChart.vue'
import DepartmentTable from '@/components/hr/DepartmentTable.vue'
import DepartmentTree from '@/components/hr/DepartmentTree.vue'
import FilterBar from '@/components/shared/FilterBar.vue'
import { buildDepartmentTree } from '@/lib/departmentTree'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useDeleteHrDepartment, useHrDepartments, type HrDepartment } from '@/composables/useHrDepartments'
import { returnToQuery } from '@/utils/safeReturnTo'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const query = useHrDepartments()
const hydrated = useHydrated()
const search = computed({ get: () => typeof route.query.q === 'string' ? route.query.q : '', set: q => { void router.replace({ query: { ...route.query, q: q || undefined } }) } })
const treeView = computed(() => route.query.view === 'tree')
const canvasView = computed(() => route.query.view === 'canvas')
const departments = computed(() => query.data.value?.items ?? [])
const roots = computed(() => buildDepartmentTree(departments.value))
const filtered = computed(() => departments.value.filter(d => `${d.name} ${d.manager?.name ?? ''}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))
const deleting = ref<HrDepartment | null>(null)
const deleteError = ref<ApiError | null>(null)
const { mutateAsync: deleteDepartment, isPending: deletingPending } = useDeleteHrDepartment()
function openDepartment(id: number) { void navigateTo({ path: `/hr/departments/${id}`, query: returnToQuery(route.fullPath) }) }
function editDepartment(id: number) { void navigateTo({ path: `/hr/departments/${id}/edit`, query: returnToQuery(route.fullPath) }) }
function createChild(id: number) { void navigateTo({ path: '/hr/departments/new', query: { ...returnToQuery(route.fullPath), parent_id: id } }) }
function setView(tree: boolean) { void router.replace({ query: { ...route.query, view: tree ? 'tree' : undefined } }) }
function setCanvasView() { void router.replace({ query: { ...route.query, view: 'canvas' } }) }
function askDelete(department: HrDepartment) { deleting.value = department; deleteError.value = null }
async function confirmDelete() {
  if (!deleting.value || !hydrated.value || deletingPending.value || !can('hr.departments.manage')) return
  try { await deleteDepartment(deleting.value.id); deleting.value = null; toast.success(t('hr.depts.deleted')) }
  catch (error) { deleteError.value = error instanceof ApiError ? error : new ApiError(500, 'http_error', t('errors.generic')) }
}
</script>
<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('hr.depts.title')" :description="t('hr.depts.pageDescription')" back-to="/hr">
      <NuxtLink v-if="can('hr.departments.manage')" :to="{ path: '/hr/departments/new', query: returnToQuery(route.fullPath) }"><Button>{{ t('hr.depts.new') }}</Button></NuxtLink>
    </SharedPageHeader>
    <div class="nasq-toolbar">
      <FilterBar class="w-full">
        <template #search>
          <div class="relative min-w-52 flex-1">
            <Search class="pointer-events-none absolute start-2 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input v-model="search" :disabled="!hydrated" :aria-label="t('hr.depts.search')" :placeholder="t('hr.depts.search')" class="ps-8" />
          </div>
        </template>
        <template #view>
          <div role="group" class="inline-flex h-[40px] items-center rounded-lg border bg-muted/40 p-0.5" :aria-label="t('hr.depts.title')">
            <Button type="button" variant="ghost" size="icon" class="size-[32px] rounded-md" :class="!treeView && !canvasView ? 'bg-background shadow-sm' : ''" :disabled="!hydrated" :aria-label="t('hr.depts.listView')" :aria-pressed="!treeView && !canvasView" data-testid="hr-departments-view-list" @click="setView(false)">
              <List class="size-[18px]" />
            </Button>
            <Button type="button" variant="ghost" size="icon" class="size-[32px] rounded-md" :class="treeView ? 'bg-background shadow-sm' : ''" :disabled="!hydrated" :aria-label="t('hr.depts.hierarchy')" :aria-pressed="treeView" data-testid="hr-departments-view-tree" @click="setView(true)">
              <Network class="size-[18px]" />
            </Button>
            <Button type="button" variant="ghost" size="icon" class="size-[32px] rounded-md" :class="canvasView ? 'bg-background shadow-sm' : ''" :disabled="!hydrated" :aria-label="t('hr.depts.orgChart')" :aria-pressed="canvasView" data-testid="hr-departments-view-canvas" @click="setCanvasView">
              <Scan class="size-[18px]" />
            </Button>
          </div>
        </template>
      </FilterBar>
    </div>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!departments.length" @retry="query.refetch">
      <DepartmentOrgChart v-if="canvasView" :roots="roots" :query="search" :hydrated="hydrated" :return-to="route.fullPath" />
      <DepartmentTree v-else-if="treeView" :roots="roots" :query="search" :hydrated="hydrated" :can-manage="can('hr.departments.manage')" :can-read-employees="can('hr.employees.read')" :can-read-documents="can('hr.documents.read')" @select="openDepartment" @edit="editDepartment" @create-child="createChild" />
      <DepartmentTable v-else :departments="filtered" :can-manage="can('hr.departments.manage')" @select="openDepartment" @delete="askDelete" />
    </SharedPageState>
    <div v-if="deleting" class="nasq-status-callout-danger p-4">
      <p class="text-sm">{{ t('hr.depts.deleteConfirm', { name: deleting.name }) }}</p><p v-if="deleteError" class="mt-2 text-sm text-destructive">{{ deleteError.message }}</p>
      <div class="mt-3 flex gap-2"><Button variant="outline" :disabled="deletingPending" @click="deleting = null">{{ t('app.cancel') }}</Button><Button variant="destructive" :disabled="!hydrated || deletingPending" @click="confirmDelete">{{ t('hr.depts.delete') }}</Button></div>
    </div>
  </SharedPageContainer>
</template>
