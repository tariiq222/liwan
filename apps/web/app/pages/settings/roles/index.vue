<script setup lang="ts">
import RoleTable from '@/components/access/roles/RoleTable.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import FilterBar from '@/components/shared/FilterBar.vue'
import { useAdminRoles, type AdminRoleListParams } from '@/composables/useAdminRoles'
import { ADMIN_PAGE_SIZE, adminListQuery, adminQueryWithOffset, parseAdminOffset } from '@/composables/adminSettingsPaths'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const forbidden = computed(() => !can('access.roles.read'))
const filters = reactive<AdminRoleListParams>({ q: String(route.query.q ?? ''), type: route.query.type === 'custom' ? 'custom' : route.query.type === 'built_in' ? 'built_in' : undefined, status: route.query.status === 'disabled' ? 'disabled' : route.query.status === 'active' ? 'active' : undefined, limit: ADMIN_PAGE_SIZE, offset: parseAdminOffset(route.query.offset) })
const query = useAdminRoles(filters, computed(() => !forbidden.value))
const page = computed(() => Math.floor((filters.offset ?? 0) / (filters.limit ?? 25)) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / (filters.limit ?? 25))))
const activeFilterCount = computed(() => Number(Boolean(filters.q?.trim())) + Number(Boolean(filters.type)) + Number(Boolean(filters.status)))
function updateFilters() { filters.offset = 0; void router.replace({ query: { ...(filters.q ? { q: filters.q } : {}), ...(filters.type ? { type: filters.type } : {}), ...(filters.status ? { status: filters.status } : {}) } }) }
function clearFilters() { filters.q = ''; filters.type = undefined; filters.status = undefined; updateFilters() }
function syncPage() { void router.replace({ query: adminQueryWithOffset(route.query, filters.offset ?? 0) }) }
function previousPage() { if (hydrated.value) { filters.offset = Math.max(0, (filters.offset ?? 0) - (filters.limit ?? 25)); syncPage() } }
function nextPage() { if (hydrated.value && page.value < pages.value) { filters.offset = (filters.offset ?? 0) + (filters.limit ?? 25); syncPage() } }
watch(() => [route.query.q, route.query.type, route.query.status, route.query.offset], ([q, type, status, offset]) => { filters.q = String(q ?? ''); filters.type = type === 'custom' ? 'custom' : type === 'built_in' ? 'built_in' : undefined; filters.status = status === 'disabled' ? 'disabled' : status === 'active' ? 'active' : undefined; filters.offset = parseAdminOffset(offset) })
const listQuery = computed(() => adminListQuery(route.query, ['q', 'type', 'status', 'offset']))
function openRole(id: number) { void navigateTo({ path: `/settings/roles/${id}`, query: listQuery.value }) }
function cloneRole(id: number) { void navigateTo({ path: '/settings/roles/new', query: { ...listQuery.value, clone: String(id) } }) }
const allValue = '__all__'
const typeOptions = computed(() => [{ value: allValue, label: t('access.roles.filters.allTypes') }, { value: 'built_in', label: t('access.roles.builtIn') }, { value: 'custom', label: t('access.roles.custom') }])
const statusOptions = computed(() => [{ value: allValue, label: t('access.roles.filters.allStatuses') }, { value: 'active', label: t('access.active') }, { value: 'disabled', label: t('access.disabled') }])
function onTypeChange(value: unknown) { filters.type = value === 'custom' ? 'custom' : value === 'built_in' ? 'built_in' : undefined; updateFilters() }
function onStatusChange(value: unknown) { filters.status = value === 'disabled' ? 'disabled' : value === 'active' ? 'active' : undefined; updateFilters() }
function clearSearch() { filters.q = ''; updateFilters() }
</script>

<template>
  <SettingsLayout>
    <SharedPageHeader :title="t('access.roles.title')">
      <UButton v-if="can('access.roles.manage')" color="primary" :disabled="!hydrated" :label="t('access.roles.create')" @click="navigateTo({ path: '/settings/roles/new', query: listQuery })" />
    </SharedPageHeader>
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <div v-else class="space-y-6">
      <div id="filters" class="nasq-settings-anchor w-full min-w-0">
        <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput v-model="filters.q" class="w-full" :aria-label="t('access.roles.filters.search')" :placeholder="t('access.roles.filters.search')" :disabled="!hydrated" @change="updateFilters" />
          </template>
          <template #default>
            <SharedFilterChoice :label="t('access.roles.columns.type')" :items="typeOptions" :model-value="filters.type ?? allValue" :disabled="!hydrated" @update:model-value="onTypeChange" />
            <SharedFilterChoice :label="t('access.roles.columns.status')" :items="statusOptions" :model-value="filters.status ?? allValue" :disabled="!hydrated" @update:model-value="onStatusChange" />
          </template>
          <template #active>
            <div v-if="activeFilterCount" class="flex flex-wrap items-center gap-2">
              <SharedFilterChip v-if="filters.q?.trim()" :label="filters.q ?? ''" @remove="clearSearch" />
              <SharedFilterChip v-if="filters.type" :label="filters.type === 'custom' ? t('access.roles.custom') : t('access.roles.builtIn')" @remove="onTypeChange(allValue)" />
              <SharedFilterChip v-if="filters.status" :label="filters.status === 'active' ? t('access.active') : t('access.disabled')" @remove="onStatusChange(allValue)" />
            </div>
          </template>
        </FilterBar>
      </div>
      <div id="results" class="nasq-settings-anchor">
        <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && query.data.value?.items.length === 0" :empty-text="t('access.roles.empty')" @retry="query.refetch">
          <RoleTable :roles="query.data.value?.items ?? []" :can-manage="can('access.roles.manage')" @open="openRole" @clone="cloneRole" />
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
