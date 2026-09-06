<script setup lang="ts">
import DepartmentTable from '@/components/hr/DepartmentTable.vue'
import DepartmentTree from '@/components/hr/DepartmentTree.vue'
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
function askDelete(department: HrDepartment) { deleting.value = department; deleteError.value = null }
async function confirmDelete() {
  if (!deleting.value || !hydrated.value || deletingPending.value || !can('hr.departments.manage')) return
  try { await deleteDepartment(deleting.value.id); deleting.value = null; toast.success(t('hr.depts.deleted')) }
  catch (error) { deleteError.value = error instanceof ApiError ? error : new ApiError(500, 'http_error', t('errors.generic')) }
}
</script>
<template>
  <div class="mx-auto w-full max-w-7xl space-y-8">
    <SharedPageHeader :title="t('hr.depts.title')" back-to="/hr">
      <NuxtLink v-if="can('hr.departments.manage')" :to="{ path: '/hr/departments/new', query: returnToQuery(route.fullPath) }"><Button>{{ t('hr.depts.new') }}</Button></NuxtLink>
    </SharedPageHeader>
    <div class="flex flex-wrap items-center gap-3 rounded-lg border border-border/80 bg-card/70 p-3">
      <Input v-model="search" :disabled="!hydrated" :aria-label="t('hr.depts.search')" :placeholder="t('hr.depts.search')" class="max-w-sm" />
      <Button variant="outline" :disabled="!hydrated" :aria-pressed="!treeView" @click="setView(false)">{{ t('hr.depts.listView') }}</Button>
      <Button variant="outline" :disabled="!hydrated" :aria-pressed="treeView" @click="setView(true)">{{ t('hr.depts.hierarchy') }}</Button>
    </div>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!departments.length" @retry="query.refetch">
      <DepartmentTree v-if="treeView" :roots="roots" :query="search" :hydrated="hydrated" :can-manage="can('hr.departments.manage')" :can-read-employees="can('hr.employees.read')" :can-read-documents="can('hr.documents.read')" @select="openDepartment" @edit="editDepartment" @create-child="createChild" />
      <DepartmentTable v-else :departments="filtered" :can-manage="can('hr.departments.manage')" @select="openDepartment" @delete="askDelete" />
    </SharedPageState>
    <div v-if="deleting" class="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
      <p class="text-sm">{{ t('hr.depts.deleteConfirm', { name: deleting.name }) }}</p><p v-if="deleteError" class="mt-2 text-sm text-destructive">{{ deleteError.message }}</p>
      <div class="mt-3 flex gap-2"><Button variant="outline" :disabled="deletingPending" @click="deleting = null">{{ t('app.cancel') }}</Button><Button variant="destructive" :disabled="!hydrated || deletingPending" @click="confirmDelete">{{ t('hr.depts.delete') }}</Button></div>
    </div>
  </div>
</template>
