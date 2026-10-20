<script setup lang="ts">
import UserTable from '@/components/access/users/UserTable.vue'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import { useAdminUsers, type AdminUserListParams } from '@/composables/useAdminUsers'
import { useAdminRoles } from '@/composables/useAdminRoles'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useEmployeeAccountBridge } from '@/composables/useEmployeeAccounts'
import { ADMIN_PAGE_SIZE, adminListQuery, adminQueryWithOffset, parseAdminOffset } from '@/composables/adminSettingsPaths'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const forbidden = computed(() => !can('access.users.read'))
const filters = reactive<AdminUserListParams>({
  q: String(route.query.q ?? ''),
  status: route.query.status === 'stopped' ? 'stopped' : route.query.status === 'active' ? 'active' : undefined,
  role_id: route.query.role_id ? Number(route.query.role_id) : undefined,
  department_id: route.query.department_id ? Number(route.query.department_id) : undefined,
  limit: ADMIN_PAGE_SIZE,
  offset: parseAdminOffset(route.query.offset),
})
// The department filter and the employee column exist only with the employee-account bridge; core rejects `department_id`.
const { departmentFilter } = useEmployeeAccountBridge()
const query = useAdminUsers(() => ({ ...filters, department_id: departmentFilter.value ? filters.department_id : undefined }), computed(() => !forbidden.value))
const roles = useAdminRoles({}, computed(() => !forbidden.value && can('access.roles.read')))
const departments = useHrDepartments()
const page = computed(() => Math.floor((filters.offset ?? 0) / (filters.limit ?? 25)) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / (filters.limit ?? 25))))
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
// The list's total as a tag in the heading, once the first page has arrived.
const countTags = computed(() => query.data.value ? [{ label: t('access.users.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
const activeFilterCount = computed(() => Number(Boolean(filters.q?.trim())) + Number(Boolean(filters.status)) + Number(Boolean(filters.role_id)) + Number(departmentFilter.value && Boolean(filters.department_id)))

function isUsersList() {
  return (route.path.replace(/\/+$/, '') || '/') === '/settings/team/users'
}
function updateFilters() {
  if (!isUsersList()) return
  filters.offset = 0
  void router.replace({ query: {
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.role_id ? { role_id: filters.role_id } : {}),
    ...(filters.department_id ? { department_id: filters.department_id } : {}),
  } })
}
function clearFilters() {
  filters.q = ''
  filters.status = undefined
  filters.role_id = undefined
  filters.department_id = undefined
  updateFilters()
}
function syncPage() { if (!isUsersList()) return; void router.replace({ query: adminQueryWithOffset(route.query, filters.offset ?? 0) }) }
function setPage(next: number) { if (hydrated.value && next >= 1 && next <= pages.value) { filters.offset = (next - 1) * (filters.limit ?? 25); syncPage() } }
watch(() => [route.query.q, route.query.status, route.query.role_id, route.query.department_id, route.query.offset], ([q, status, roleId, departmentId, offset]) => {
  filters.q = String(q ?? '')
  filters.status = status === 'stopped' ? 'stopped' : status === 'active' ? 'active' : undefined
  filters.role_id = roleId ? Number(roleId) : undefined
  filters.department_id = departmentId ? Number(departmentId) : undefined
  filters.offset = parseAdminOffset(offset)
})
const listQuery = computed(() => adminListQuery(route.query, ['q', 'status', 'role_id', 'department_id', 'offset']))
const userTo = (user: { id: number }) => ({ path: `/settings/team/users/${user.id}`, query: listQuery.value })
const allValue = '__all__'
const statusOptions = computed(() => [{ value: allValue, label: t('access.users.filters.allStatuses') }, { value: 'active', label: t('access.active') }, { value: 'stopped', label: t('access.disabled') }])
const roleOptions = computed(() => [{ value: allValue, label: t('access.users.filters.allRoles') }, ...(roles.data.value?.items ?? []).map(role => ({ value: String(role.id), label: role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar }))])
const departmentOptions = computed(() => [{ value: allValue, label: t('access.users.filters.allDepartments') }, ...(departments.data.value?.items ?? []).map(department => ({ value: String(department.id), label: department.name }))])
function onStatusChange(value: unknown) { filters.status = value === 'stopped' ? 'stopped' : value === 'active' ? 'active' : undefined; updateFilters() }
function onRoleChange(value: unknown) { filters.role_id = value && value !== allValue ? Number(value) : undefined; updateFilters() }
function onDepartmentChange(value: unknown) { filters.department_id = value && value !== allValue ? Number(value) : undefined; updateFilters() }
function clearSearch() { filters.q = ''; updateFilters() }
</script>

<template>
  <SharedListPage
    data-testid="settings-layout"
    :title="t('access.users.title')"
    :tags="countTags"
    :create-to="can('access.users.grant') ? { path: '/settings/team/users/new', query: listQuery } : undefined"
    :create-label="t('access.users.grantAccount')"
    create-test-id="settings-user-new"
  >
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <SharedListCard v-else>
      <template #filters>
        <div id="filters" class="w-full min-w-0">
          <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
            <template #search>
              <UInput v-model="filters.q" :aria-label="t('access.users.filters.searchNameLogin')" :placeholder="t('access.users.filters.searchNameLogin')" icon="i-lucide-search" class="min-w-48 flex-1" :disabled="!hydrated" @change="updateFilters">
                <template v-if="filters.q" #trailing>
                  <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('access.users.filters.clearSearch')" class="-me-1" @click="clearSearch" />
                </template>
              </UInput>
            </template>
            <template #default>
              <USelect class="w-full md:w-40" :items="statusOptions" :model-value="filters.status ?? allValue" :aria-label="t('access.users.columns.status')" :disabled="!hydrated" @update:model-value="onStatusChange" />
              <USelect class="w-full md:w-48" :items="roleOptions" :model-value="filters.role_id ? String(filters.role_id) : allValue" :aria-label="t('access.users.role')" :disabled="!hydrated" @update:model-value="onRoleChange" />
              <USelect v-if="departmentFilter" class="w-full md:w-48" :items="departmentOptions" :model-value="filters.department_id ? String(filters.department_id) : allValue" :aria-label="t('nav.departments')" :disabled="!hydrated" @update:model-value="onDepartmentChange" />
            </template>
          </FilterBar>
        </div>
      </template>
      <UserTable
        id="results"
        :users="items"
        :loading="query.isLoading.value"
        :error="query.error.value"
        :empty-text="t('access.users.empty')"
        :to-for="userTo"
        @retry="query.refetch"
      />
      <template v-if="query.data.value && items.length" #footer>
        <SharedListFooter :count-label="t('access.footer.results', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="query.isFetching.value" @update:page="setPage" />
      </template>
    </SharedListCard>
  </SharedListPage>
</template>
