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
const sections = computed(() => forbidden.value ? [] : [
  { id: 'filters', label: t('settings.toc.filters') },
  { id: 'results', label: t('settings.toc.list') },
])
</script>

<template>
  <SettingsLayout :sections>
    <SharedPageHeader :title="t('access.users.title')">
      <Button v-if="can('access.users.grant')" :disabled="!hydrated" @click="navigateTo({ path: '/settings/users/new', query: listQuery })">{{ t('access.users.grantAccount') }}</Button>
    </SharedPageHeader>
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <div v-else class="space-y-3">
      <div id="filters" class="nasq-settings-anchor w-full min-w-0">
        <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <label class="min-w-52 flex-1"><span class="sr-only">{{ t('access.users.filters.search') }}</span><Input class="w-full" v-model="filters.q" :placeholder="t('access.users.filters.search')" :disabled="!hydrated" @change="updateFilters" /></label>
          </template>
          <template #default>
            <label><span>{{ t('access.users.columns.status') }}</span><select v-model="filters.status" class="h-[40px] rounded-lg border border-input bg-background px-3 text-sm" :disabled="!hydrated" :aria-label="t('access.users.columns.status')" @change="updateFilters">
              <option :value="undefined">{{ t('access.users.filters.allStatuses') }}</option>
              <option value="active">{{ t('access.active') }}</option>
              <option value="stopped">{{ t('access.disabled') }}</option>
            </select></label>
            <label><span>{{ t('access.users.role') }}</span><select v-model="filters.role_id" class="h-[40px] rounded-lg border border-input bg-background px-3 text-sm" :disabled="!hydrated" :aria-label="t('access.users.role')" @change="updateFilters"><option :value="undefined">{{ t('access.users.filters.allRoles') }}</option><option v-for="role in roles.data.value?.items ?? []" :key="role.id" :value="role.id">{{ role.name[locale === 'ar' ? 'ar' : 'en'] ?? role.name.ar }}</option></select></label>
            <label><span>{{ t('nav.departments') }}</span><select v-model="filters.department_id" class="h-[40px] rounded-lg border border-input bg-background px-3 py-2 text-sm" :disabled="!hydrated || !can('hr.departments.read')" :aria-label="t('nav.departments')" @change="updateFilters"><option :value="undefined">{{ t('access.users.filters.allDepartments') }}</option><option v-for="department in departments.data.value?.items ?? []" :key="department.id" :value="department.id">{{ department.name }}</option></select></label>
          </template>
          <template #active>
            <div v-if="activeFilterCount" class="flex flex-wrap items-center gap-2">
              <Badge v-if="filters.q?.trim()" variant="secondary">{{ filters.q }}</Badge>
              <Badge v-if="filters.status" variant="secondary">{{ filters.status === 'active' ? t('access.active') : t('access.disabled') }}</Badge>
              <Badge v-if="filters.role_id" variant="secondary">{{ roles.data.value?.items.find(role => role.id === filters.role_id)?.name[locale === 'ar' ? 'ar' : 'en'] ?? t('access.users.role') }}</Badge>
              <Badge v-if="filters.department_id" variant="secondary">{{ departments.data.value?.items.find(department => department.id === filters.department_id)?.name ?? t('nav.departments') }}</Badge>
            </div>
          </template>
        </FilterBar>
      </div>
      <div id="results" class="nasq-settings-anchor">
      <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && query.data.value?.items.length === 0" :empty-text="t('access.users.empty')" @retry="query.refetch">
        <UserTable :users="query.data.value?.items ?? []" @open="openUser" />
      </SharedPageState>
      <div v-if="pages > 1" class="nasq-settings-pagination"><Button variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" @click="previousPage">{{ t('access.previousPage') }}</Button><span>{{ t('access.pageOf', { page, pages }) }}</span><Button variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" @click="nextPage">{{ t('access.nextPage') }}</Button></div>
      </div>
    </div>
  </SettingsLayout>
</template>
