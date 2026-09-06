<script setup lang="ts">
import UserTable from '@/components/access/users/UserTable.vue'
import { useAdminUsers, type AdminUserListParams } from '@/composables/useAdminUsers'
import { useAdminRoles } from '@/composables/useAdminRoles'
import { useHrDepartments } from '@/composables/useHrDepartments'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const forbidden = computed(() => !can('access.users.read'))
const filters = reactive<AdminUserListParams>({
  q: String(route.query.q ?? ''),
  status: route.query.status === 'stopped' ? 'stopped' : route.query.status === 'active' ? 'active' : undefined,
  role_id: route.query.role_id ? Number(route.query.role_id) : undefined,
  department_id: route.query.department_id ? Number(route.query.department_id) : undefined,
  limit: 25,
  offset: route.query.offset ? Number(route.query.offset) : 0,
})
const query = useAdminUsers(filters, computed(() => !forbidden.value))
const roles = useAdminRoles({}, computed(() => !forbidden.value && can('access.roles.read')))
const departments = useHrDepartments()
const page = computed(() => Math.floor((filters.offset ?? 0) / (filters.limit ?? 25)) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / (filters.limit ?? 25))))

function updateFilters() {
  filters.offset = 0
  void router.replace({ query: {
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.role_id ? { role_id: filters.role_id } : {}),
    ...(filters.department_id ? { department_id: filters.department_id } : {}),
  } })
}
function syncPage() { void router.replace({ query: { ...route.query, ...(filters.offset ? { offset: filters.offset } : {}) } }) }
function previousPage() { if (hydrated.value) { filters.offset = Math.max(0, (filters.offset ?? 0) - (filters.limit ?? 25)); syncPage() } }
function nextPage() { if (hydrated.value && page.value < pages.value) { filters.offset = (filters.offset ?? 0) + (filters.limit ?? 25); syncPage() } }
watch(() => [route.query.q, route.query.status, route.query.role_id, route.query.department_id, route.query.offset], ([q, status, roleId, departmentId, offset]) => {
  filters.q = String(q ?? '')
  filters.status = status === 'stopped' ? 'stopped' : status === 'active' ? 'active' : undefined
  filters.role_id = roleId ? Number(roleId) : undefined
  filters.department_id = departmentId ? Number(departmentId) : undefined
  filters.offset = offset ? Number(offset) : 0
})
function openUser(id: number) { void navigateTo({ path: `/settings/users/${id}`, query: route.query }) }
</script>

<template>
  <div class="mx-auto w-full max-w-7xl space-y-8">
    <SharedPageHeader :title="t('access.users.title')" :description="t('access.users.description')">
      <Button v-if="can('access.users.grant')" :disabled="!hydrated" @click="navigateTo('/settings/users/new')">{{ t('access.users.grantAccount') }}</Button>
    </SharedPageHeader>
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <template v-else>
      <div class="grid gap-3 rounded-lg border border-border/80 bg-card/70 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]">
        <Input v-model="filters.q" :placeholder="t('access.users.filters.search')" :disabled="!hydrated" @change="updateFilters" />
        <select v-model="filters.status" class="h-9 rounded-md border border-input bg-background px-3 text-sm" :disabled="!hydrated" @change="updateFilters">
          <option :value="undefined">{{ t('access.users.filters.allStatuses') }}</option>
          <option value="active">{{ t('access.active') }}</option>
          <option value="stopped">{{ t('access.disabled') }}</option>
        </select>
        <select v-model="filters.role_id" class="h-9 rounded-md border border-input bg-background px-3 text-sm" :disabled="!hydrated" @change="updateFilters"><option :value="undefined">{{ t('access.users.filters.allRoles') }}</option><option v-for="role in roles.data.value?.items ?? []" :key="role.id" :value="role.id">{{ role.name.ar }}</option></select>
        <select v-model="filters.department_id" class="h-9 rounded-md border border-input bg-background px-3 text-sm" :disabled="!hydrated || !can('hr.departments.read')" @change="updateFilters"><option :value="undefined">{{ t('access.users.filters.allDepartments') }}</option><option v-for="department in departments.data.value?.items ?? []" :key="department.id" :value="department.id">{{ department.name }}</option></select>
        <Button variant="outline" :disabled="!hydrated" @click="filters.q = ''; filters.status = undefined; filters.role_id = undefined; filters.department_id = undefined; updateFilters()">{{ t('access.clearFilters') }}</Button>
      </div>
      <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && query.data.value?.items.length === 0" :empty-text="t('access.users.empty')" @retry="query.refetch">
        <UserTable :users="query.data.value?.items ?? []" @open="openUser" />
      </SharedPageState>
      <div v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground"><Button variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" @click="previousPage">{{ t('access.previousPage') }}</Button><span>{{ t('access.pageOf', { page, pages }) }}</span><Button variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" @click="nextPage">{{ t('access.nextPage') }}</Button></div>
    </template>
  </div>
</template>
