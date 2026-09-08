<script setup lang="ts">
import RoleTable from '@/components/access/roles/RoleTable.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
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
function updateFilters() { filters.offset = 0; void router.replace({ query: { ...(filters.q ? { q: filters.q } : {}), ...(filters.type ? { type: filters.type } : {}), ...(filters.status ? { status: filters.status } : {}) } }) }
function syncPage() { void router.replace({ query: adminQueryWithOffset(route.query, filters.offset ?? 0) }) }
function previousPage() { if (hydrated.value) { filters.offset = Math.max(0, (filters.offset ?? 0) - (filters.limit ?? 25)); syncPage() } }
function nextPage() { if (hydrated.value && page.value < pages.value) { filters.offset = (filters.offset ?? 0) + (filters.limit ?? 25); syncPage() } }
watch(() => [route.query.q, route.query.type, route.query.status, route.query.offset], ([q, type, status, offset]) => { filters.q = String(q ?? ''); filters.type = type === 'custom' ? 'custom' : type === 'built_in' ? 'built_in' : undefined; filters.status = status === 'disabled' ? 'disabled' : status === 'active' ? 'active' : undefined; filters.offset = parseAdminOffset(offset) })
const listQuery = computed(() => adminListQuery(route.query, ['q', 'type', 'status', 'offset']))
function openRole(id: number) { void navigateTo({ path: `/settings/roles/${id}`, query: listQuery.value }) }
function cloneRole(id: number) { void navigateTo({ path: '/settings/roles/new', query: { ...listQuery.value, clone: String(id) } }) }
const sections = computed(() => forbidden.value ? [] : [
  { id: 'filters', label: t('settings.toc.filters') },
  { id: 'results', label: t('settings.toc.list') },
])
</script>

<template>
  <SettingsLayout :sections>
    <SharedPageHeader :title="t('access.roles.title')">
      <Button v-if="can('access.roles.manage')" :disabled="!hydrated" @click="navigateTo({ path: '/settings/roles/new', query: listQuery })">{{ t('access.roles.create') }}</Button>
    </SharedPageHeader>
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <div v-else class="nasq-panel">
      <div id="filters" class="nasq-settings-filters nasq-settings-anchor">
        <label class="nasq-settings-field nasq-settings-search"><span>{{ t('access.roles.filters.search') }}</span><Input class="w-full" v-model="filters.q" :placeholder="t('access.roles.filters.search')" :disabled="!hydrated" @change="updateFilters" /></label>
        <label class="nasq-settings-field"><span>{{ t('access.roles.columns.type') }}</span><select v-model="filters.type" :disabled="!hydrated" class="h-[40px] rounded-lg border border-input bg-background px-3 text-sm" @change="updateFilters"><option :value="undefined">{{ t('access.roles.filters.allTypes') }}</option><option value="built_in">{{ t('access.roles.builtIn') }}</option><option value="custom">{{ t('access.roles.custom') }}</option></select></label>
        <label class="nasq-settings-field"><span>{{ t('access.roles.columns.status') }}</span><select v-model="filters.status" :disabled="!hydrated" class="h-[40px] rounded-lg border border-input bg-background px-3 text-sm" @change="updateFilters"><option :value="undefined">{{ t('access.roles.filters.allStatuses') }}</option><option value="active">{{ t('access.active') }}</option><option value="disabled">{{ t('access.disabled') }}</option></select></label>
        <div class="nasq-settings-filter-actions"><Button variant="outline" :disabled="!hydrated" @click="filters.q = ''; filters.type = undefined; filters.status = undefined; updateFilters()">{{ t('access.clearFilters') }}</Button></div>
      </div>
      <div id="results" class="nasq-settings-anchor">
      <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && query.data.value?.items.length === 0" :empty-text="t('access.roles.empty')" @retry="query.refetch">
        <RoleTable :roles="query.data.value?.items ?? []" :can-manage="can('access.roles.manage')" @open="openRole" @clone="cloneRole" />
      </SharedPageState>
      <div v-if="pages > 1" class="nasq-settings-pagination"><Button variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" @click="previousPage">{{ t('access.previousPage') }}</Button><span>{{ t('access.pageOf', { page, pages }) }}</span><Button variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" @click="nextPage">{{ t('access.nextPage') }}</Button></div>
      </div>
    </div>
  </SettingsLayout>
</template>
