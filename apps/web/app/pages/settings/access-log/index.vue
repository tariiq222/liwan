<script setup lang="ts">
import type { AuditAction } from '@webvue/contracts'
import AuditTable from '@/components/access/audit/AuditTable.vue'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import { useAdminAuditLog, type AdminAuditListParams } from '@/composables/useAdminAudit'
import { useAdminUsers } from '@/composables/useAdminUsers'
import { useAdminRoles } from '@/composables/useAdminRoles'
import { ADMIN_PAGE_SIZE, adminQueryWithOffset, parseAdminOffset } from '@/composables/adminSettingsPaths'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const forbidden = computed(() => !can('access.audit.read'))
const actionLabels: Record<AuditAction, string> = {
  'user.granted': 'access.audit.actions.userGranted', 'user.roles_changed': 'access.audit.actions.userRolesChanged', 'user.disabled': 'access.audit.actions.userDisabled', 'user.reactivated': 'access.audit.actions.userReactivated', 'user.password_reset': 'access.audit.actions.userPasswordReset', 'employee.archived_access_disabled': 'access.audit.actions.employeeArchived', 'role.created': 'access.audit.actions.roleCreated', 'role.updated': 'access.audit.actions.roleUpdated', 'role.disabled': 'access.audit.actions.roleDisabled', 'role.enabled': 'access.audit.actions.roleEnabled', 'role.deleted': 'access.audit.actions.roleDeleted', 'migration.legacy_admin_preserved': 'access.audit.actions.legacyAdminPreserved',
}
const actionOptions = Object.keys(actionLabels) as AuditAction[]
const actionFromQuery = String(route.query.action ?? '')
const filters = reactive<AdminAuditListParams>({ from: String(route.query.from ?? '') || undefined, to: String(route.query.to ?? '') || undefined, actor_id: route.query.actor_id ? Number(route.query.actor_id) : undefined, target_type: route.query.target_type === 'role' ? 'role' : route.query.target_type === 'user' ? 'user' : undefined, target_id: route.query.target_id ? Number(route.query.target_id) : undefined, action: actionOptions.includes(actionFromQuery as AuditAction) ? actionFromQuery : undefined, limit: ADMIN_PAGE_SIZE, offset: parseAdminOffset(route.query.offset) })
const query = useAdminAuditLog(filters, computed(() => !forbidden.value))
const actors = useAdminUsers({}, computed(() => !forbidden.value && can('access.users.read')))
const targetRoles = useAdminRoles({}, computed(() => !forbidden.value && can('access.roles.read')))
const targetOptions = computed(() => filters.target_type === 'role' ? (targetRoles.data.value?.items ?? []).map((role) => ({ id: role.id, name: role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar })) : (actors.data.value?.items ?? []).map((user) => ({ id: user.id, name: user.name })))
const page = computed(() => Math.floor((filters.offset ?? 0) / (filters.limit ?? ADMIN_PAGE_SIZE)) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / (filters.limit ?? ADMIN_PAGE_SIZE))))
const activeFilterCount = computed(() => Number(Boolean(filters.from)) + Number(Boolean(filters.to)) + Number(Boolean(filters.actor_id)) + Number(Boolean(filters.target_type)) + Number(Boolean(filters.target_id)) + Number(Boolean(filters.action)))
function updateFilters() { filters.offset = 0; void router.replace({ query: { ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}), ...(filters.actor_id ? { actor_id: filters.actor_id } : {}), ...(filters.target_type ? { target_type: filters.target_type } : {}), ...(filters.target_id ? { target_id: filters.target_id } : {}), ...(filters.action ? { action: filters.action } : {}) } }) }
function clearFilters() { filters.from = undefined; filters.to = undefined; filters.actor_id = undefined; filters.target_type = undefined; filters.target_id = undefined; filters.action = undefined; updateFilters() }
function syncPage() { void router.replace({ query: adminQueryWithOffset(route.query, filters.offset ?? 0) }) }
function setPage(next: number) { if (hydrated.value && next >= 1 && next <= pages.value) { filters.offset = (next - 1) * (filters.limit ?? ADMIN_PAGE_SIZE); syncPage() } }
watch(() => [route.query.from, route.query.to, route.query.actor_id, route.query.target_type, route.query.target_id, route.query.action, route.query.offset], ([from, to, actorId, targetType, targetId, action, offset]) => { filters.from = String(from ?? '') || undefined; filters.to = String(to ?? '') || undefined; filters.actor_id = actorId ? Number(actorId) : undefined; filters.target_type = targetType === 'role' ? 'role' : targetType === 'user' ? 'user' : undefined; filters.target_id = targetId ? Number(targetId) : undefined; filters.action = actionOptions.includes(String(action) as AuditAction) ? String(action) : undefined; filters.offset = parseAdminOffset(offset) })
const allValue = '__all__'
const actorOptions = computed(() => [{ value: allValue, label: t('access.audit.filters.allActors') }, ...(actors.data.value?.items ?? []).map(actor => ({ value: String(actor.id), label: actor.name }))])
const targetTypeOptions = computed(() => [{ value: allValue, label: t('access.audit.filters.allTargets') }, { value: 'user', label: t('access.users.title') }, { value: 'role', label: t('access.roles.title') }])
const targetIdOptions = computed(() => [{ value: allValue, label: t('access.audit.filters.chooseTarget') }, ...targetOptions.value.map(target => ({ value: String(target.id), label: target.name }))])
const actionSelectOptions = computed(() => [{ value: allValue, label: t('access.audit.filters.allActions') }, ...actionOptions.map(action => ({ value: action, label: t(actionLabels[action]) }))])
function onActorChange(value: unknown) { filters.actor_id = value && value !== allValue ? Number(value) : undefined; updateFilters() }
function onTargetTypeChange(value: unknown) { filters.target_type = value === 'role' ? 'role' : value === 'user' ? 'user' : undefined; filters.target_id = undefined; updateFilters() }
function onTargetIdChange(value: unknown) { filters.target_id = value && value !== allValue ? Number(value) : undefined; updateFilters() }
function onActionChange(value: unknown) { filters.action = value && value !== allValue ? String(value) : undefined; updateFilters() }
function auditTo(id: number) { return { path: `/settings/access-log/${id}`, query: route.query } }
function setDate(key: 'from' | 'to', value: string | null) { filters[key] = value || undefined; updateFilters() }
function clearDate(key: 'from' | 'to') { setDate(key, null) }
</script>

<template>
  <SharedListPage data-testid="settings-layout" :title="t('access.audit.title')" :description="forbidden ? undefined : t('access.audit.description')">
    <template v-if="!forbidden" #filters>
      <div id="filters" class="w-full min-w-0">
        <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #default>
            <SharedFilterField :label="t('access.audit.filters.from')" for="access-log-from"><SharedDateField id="access-log-from" :model-value="filters.from ?? null" :max-value="filters.to ?? null" :disabled="!hydrated" @update:model-value="setDate('from', $event)" /></SharedFilterField>
            <SharedFilterField :label="t('access.audit.filters.to')" for="access-log-to"><SharedDateField id="access-log-to" :model-value="filters.to ?? null" :min-value="filters.from ?? null" :disabled="!hydrated" @update:model-value="setDate('to', $event)" /></SharedFilterField>
            <SharedFilterField :label="t('access.audit.columns.actor')" for="access-log-actor"><USelect id="access-log-actor" :model-value="filters.actor_id ? String(filters.actor_id) : allValue" :items="actorOptions" class="w-full" :disabled="!hydrated || actors.isLoading.value" @update:model-value="onActorChange" /></SharedFilterField>
            <SharedFilterChoice :label="t('access.roles.columns.type')" :items="targetTypeOptions" :model-value="filters.target_type ?? allValue" :disabled="!hydrated" @update:model-value="onTargetTypeChange" />
            <SharedFilterField :label="t('access.audit.columns.target')" for="access-log-target"><USelect id="access-log-target" :model-value="filters.target_id ? String(filters.target_id) : allValue" :items="targetIdOptions" class="w-full" :disabled="!hydrated || !filters.target_type" @update:model-value="onTargetIdChange" /></SharedFilterField>
            <SharedFilterField :label="t('access.audit.columns.action')" for="access-log-action"><USelect id="access-log-action" :model-value="filters.action ?? allValue" :items="actionSelectOptions" class="w-full" :disabled="!hydrated" @update:model-value="onActionChange" /></SharedFilterField>
          </template>
          <template #active>
            <div v-if="activeFilterCount" class="flex flex-wrap items-center gap-2">
              <SharedFilterChip v-if="filters.from" :label="`${t('access.audit.filters.from')}: ${filters.from}`" @remove="clearDate('from')" />
              <SharedFilterChip v-if="filters.to" :label="`${t('access.audit.filters.to')}: ${filters.to}`" @remove="clearDate('to')" />
              <SharedFilterChip v-if="filters.actor_id" :label="actors.data.value?.items.find(actor => actor.id === filters.actor_id)?.name ?? t('access.audit.columns.actor')" @remove="onActorChange(allValue)" />
              <SharedFilterChip v-if="filters.target_type" :label="filters.target_type === 'role' ? t('access.roles.title') : t('access.users.title')" @remove="onTargetTypeChange(allValue)" />
              <SharedFilterChip v-if="filters.target_id" :label="targetOptions.find(target => target.id === filters.target_id)?.name ?? t('access.audit.columns.target')" @remove="onTargetIdChange(allValue)" />
              <SharedFilterChip v-if="filters.action" :label="t(actionLabels[filters.action as keyof typeof actionLabels])" @remove="onActionChange(allValue)" />
            </div>
          </template>
        </FilterBar>
      </div>
    </template>

    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <div v-else class="grid gap-3">
      <AuditTable
        id="results"
        :events="query.data.value?.items ?? []"
        :loading="query.isLoading.value"
        :error="query.error.value"
        :empty-text="t('access.audit.empty')"
        :to-for="auditTo"
        @retry="query.refetch"
      />
      <SharedPagination :page="page" :pages="pages" :disabled="query.isFetching.value" @update:page="setPage" />
    </div>
  </SharedListPage>
</template>
