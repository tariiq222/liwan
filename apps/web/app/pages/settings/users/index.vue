<script setup lang="ts">
import UserTable from '@/components/access/users/UserTable.vue'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import { useAdminUsers, type AdminUserListParams } from '@/composables/useAdminUsers'
import { useAdminRoles } from '@/composables/useAdminRoles'
import { useHrDepartments } from '@/composables/useHrDepartments'
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
const query = useAdminUsers(filters, computed(() => !forbidden.value))
const roles = useAdminRoles({}, computed(() => !forbidden.value && can('access.roles.read')))
const departments = useHrDepartments()
const page = computed(() => Math.floor((filters.offset ?? 0) / (filters.limit ?? 25)) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / (filters.limit ?? 25))))
const activeFilterCount = computed(() => Number(Boolean(filters.q?.trim())) + Number(Boolean(filters.status)) + Number(Boolean(filters.role_id)) + Number(Boolean(filters.department_id)))

function isUsersList() {
  return (route.path.replace(/\/+$/, '') || '/') === '/settings/users'
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
const userTo = (user: { id: number }) => ({ path: `/settings/users/${user.id}`, query: listQuery.value })
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
    :create-to="can('access.users.grant') ? { path: '/settings/users/new', query: listQuery } : undefined"
    :create-label="t('access.users.grantAccount')"
    create-test-id="settings-user-new"
  >
    <template v-if="!forbidden" #filters>
      <div id="filters" class="w-full min-w-0">
        <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput v-model="filters.q" class="w-full" :aria-label="t('access.users.filters.searchNameLogin')" :placeholder="t('access.users.filters.searchNameLogin')" :disabled="!hydrated" @change="updateFilters" />
          </template>
          <template #default>
            <SharedFilterChoice :label="t('access.users.columns.status')" :items="statusOptions" :model-value="filters.status ?? allValue" :disabled="!hydrated" @update:model-value="onStatusChange" />
            <SharedFilterField :label="t('access.users.role')" for="settings-users-role"><USelect id="settings-users-role" :model-value="filters.role_id ? String(filters.role_id) : allValue" :items="roleOptions" class="w-full" :disabled="!hydrated" @update:model-value="onRoleChange" /></SharedFilterField>
            <SharedFilterField :label="t('nav.departments')" for="settings-users-department"><USelect id="settings-users-department" :model-value="filters.department_id ? String(filters.department_id) : allValue" :items="departmentOptions" class="w-full" :disabled="!hydrated || !can('hr.departments.read')" @update:model-value="onDepartmentChange" /></SharedFilterField>
          </template>
          <template #active>
            <div v-if="activeFilterCount" class="flex flex-wrap items-center gap-2">
              <SharedFilterChip v-if="filters.q?.trim()" :label="filters.q ?? ''" @remove="clearSearch" />
              <SharedFilterChip v-if="filters.status" :label="filters.status === 'active' ? t('access.active') : t('access.disabled')" @remove="onStatusChange(allValue)" />
              <SharedFilterChip v-if="filters.role_id" :label="roles.data.value?.items.find(role => role.id === filters.role_id)?.name[locale === 'ar' ? 'ar' : 'en'] ?? t('access.users.role')" @remove="onRoleChange(allValue)" />
              <SharedFilterChip v-if="filters.department_id" :label="departments.data.value?.items.find(department => department.id === filters.department_id)?.name ?? t('nav.departments')" @remove="onDepartmentChange(allValue)" />
            </div>
          </template>
        </FilterBar>
      </div>
    </template>

    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <div v-else class="grid gap-3">
      <UserTable
        id="results"
        :users="query.data.value?.items ?? []"
        :loading="query.isLoading.value"
        :error="query.error.value"
        :empty-text="t('access.users.empty')"
        :to-for="userTo"
        @retry="query.refetch"
      />
      <SharedPagination :page="page" :pages="pages" :disabled="query.isFetching.value" @update:page="setPage" />
    </div>
  </SharedListPage>
</template>
