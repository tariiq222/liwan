<script setup lang="ts">
import UserTable from '@/components/access/users/UserTable.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import FilterBar from '@/components/shared/FilterBar.vue'
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

function updateFilters() {
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
function syncPage() { void router.replace({ query: adminQueryWithOffset(route.query, filters.offset ?? 0) }) }
function previousPage() { if (hydrated.value) { filters.offset = Math.max(0, (filters.offset ?? 0) - (filters.limit ?? 25)); syncPage() } }
function nextPage() { if (hydrated.value && page.value < pages.value) { filters.offset = (filters.offset ?? 0) + (filters.limit ?? 25); syncPage() } }
watch(() => [route.query.q, route.query.status, route.query.role_id, route.query.department_id, route.query.offset], ([q, status, roleId, departmentId, offset]) => {
  filters.q = String(q ?? '')
  filters.status = status === 'stopped' ? 'stopped' : status === 'active' ? 'active' : undefined
  filters.role_id = roleId ? Number(roleId) : undefined
  filters.department_id = departmentId ? Number(departmentId) : undefined
  filters.offset = parseAdminOffset(offset)
})
const listQuery = computed(() => adminListQuery(route.query, ['q', 'status', 'role_id', 'department_id', 'offset']))
function openUser(id: number) { void navigateTo({ path: `/settings/users/${id}`, query: listQuery.value }) }
const allValue = '__all__'
const statusOptions = computed(() => [{ value: allValue, label: t('access.users.filters.allStatuses') }, { value: 'active', label: t('access.active') }, { value: 'stopped', label: t('access.disabled') }])
const roleOptions = computed(() => [{ value: allValue, label: t('access.users.filters.allRoles') }, ...(roles.data.value?.items ?? []).map(role => ({ value: String(role.id), label: role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar }))])
const departmentOptions = computed(() => [{ value: allValue, label: t('access.users.filters.allDepartments') }, ...(departments.data.value?.items ?? []).map(department => ({ value: String(department.id), label: department.name }))])
function onStatusChange(value: unknown) { filters.status = value === 'stopped' ? 'stopped' : value === 'active' ? 'active' : undefined; updateFilters() }
function onRoleChange(value: unknown) { filters.role_id = value && value !== allValue ? Number(value) : undefined; updateFilters() }
function onDepartmentChange(value: unknown) { filters.department_id = value && value !== allValue ? Number(value) : undefined; updateFilters() }
</script>

<template>
  <SettingsLayout>
    <SharedPageHeader :title="t('access.users.title')">
      <UButton v-if="can('access.users.grant')" color="primary" :disabled="!hydrated" :label="t('access.users.grantAccount')" @click="navigateTo({ path: '/settings/users/new', query: listQuery })" />
    </SharedPageHeader>
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <div v-else class="space-y-6">
      <div id="filters" class="nasq-settings-anchor w-full min-w-0">
        <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput v-model="filters.q" class="w-full" :aria-label="t('access.users.filters.search')" :placeholder="t('access.users.filters.search')" :disabled="!hydrated" @change="updateFilters" />
          </template>
          <template #default>
            <UFormField :label="t('access.users.columns.status')" class="min-w-0"><USelect :model-value="filters.status ?? allValue" :items="statusOptions" class="w-full" :disabled="!hydrated" :aria-label="t('access.users.columns.status')" @update:model-value="onStatusChange" /></UFormField>
            <UFormField :label="t('access.users.role')" class="min-w-0"><USelect :model-value="filters.role_id ? String(filters.role_id) : allValue" :items="roleOptions" class="w-full" :disabled="!hydrated" :aria-label="t('access.users.role')" @update:model-value="onRoleChange" /></UFormField>
            <UFormField :label="t('nav.departments')" class="min-w-0"><USelect :model-value="filters.department_id ? String(filters.department_id) : allValue" :items="departmentOptions" class="w-full" :disabled="!hydrated || !can('hr.departments.read')" :aria-label="t('nav.departments')" @update:model-value="onDepartmentChange" /></UFormField>
          </template>
          <template #active>
            <div v-if="activeFilterCount" class="flex flex-wrap items-center gap-2">
              <UBadge v-if="filters.q?.trim()" color="neutral" variant="subtle">{{ filters.q }}</UBadge>
              <UBadge v-if="filters.status" color="neutral" variant="subtle">{{ filters.status === 'active' ? t('access.active') : t('access.disabled') }}</UBadge>
              <UBadge v-if="filters.role_id" color="neutral" variant="subtle">{{ roles.data.value?.items.find(role => role.id === filters.role_id)?.name[locale === 'ar' ? 'ar' : 'en'] ?? t('access.users.role') }}</UBadge>
              <UBadge v-if="filters.department_id" color="neutral" variant="subtle">{{ departments.data.value?.items.find(department => department.id === filters.department_id)?.name ?? t('nav.departments') }}</UBadge>
            </div>
          </template>
        </FilterBar>
      </div>
      <div id="results" class="nasq-settings-anchor">
        <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && query.data.value?.items.length === 0" :empty-text="t('access.users.empty')" @retry="query.refetch">
          <UserTable :users="query.data.value?.items ?? []" @open="openUser" />
        </SharedPageState>
        <div v-if="pages > 1" class="nasq-settings-pagination">
          <UButton color="neutral" variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" :label="t('access.previousPage')" @click="previousPage" />
          <span>{{ t('access.pageOf', { page, pages }) }}</span>
          <UButton color="neutral" variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" :label="t('access.nextPage')" @click="nextPage" />
        </div>
      </div>
    </div>
  </SettingsLayout>
</template>
