<script setup lang="ts">
import type { AuditAction } from '@nasq/contracts'
import AuditTable from '@/components/access/audit/AuditTable.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import FilterBar from '@/components/shared/FilterBar.vue'
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
function previousPage() { if (hydrated.value) { filters.offset = Math.max(0, (filters.offset ?? 0) - (filters.limit ?? ADMIN_PAGE_SIZE)); syncPage() } }
function nextPage() { if (hydrated.value && page.value < pages.value) { filters.offset = (filters.offset ?? 0) + (filters.limit ?? ADMIN_PAGE_SIZE); syncPage() } }
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
</script>

<template>
  <SettingsLayout>
    <SharedPageHeader :title="t('access.audit.title')" />
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <div v-else class="space-y-6">
      <p class="text-sm leading-6 text-muted">{{ t('access.audit.description') }}</p>
      <div id="filters" class="nasq-settings-anchor w-full min-w-0">
        <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #default>
            <UFormField :label="t('access.audit.filters.from')" class="min-w-0"><UInput v-model="filters.from" type="date" class="w-full" :disabled="!hydrated" :aria-label="t('access.audit.filters.from')" @change="updateFilters" /></UFormField>
            <UFormField :label="t('access.audit.filters.to')" class="min-w-0"><UInput v-model="filters.to" type="date" class="w-full" :disabled="!hydrated" :aria-label="t('access.audit.filters.to')" @change="updateFilters" /></UFormField>
            <UFormField :label="t('access.audit.columns.actor')" class="min-w-0"><USelect :model-value="filters.actor_id ? String(filters.actor_id) : allValue" :items="actorOptions" class="w-full" :disabled="!hydrated || actors.isLoading.value" :aria-label="t('access.audit.columns.actor')" @update:model-value="onActorChange" /></UFormField>
            <UFormField :label="t('access.roles.columns.type')" class="min-w-0"><USelect :model-value="filters.target_type ?? allValue" :items="targetTypeOptions" class="w-full" :disabled="!hydrated" :aria-label="t('access.roles.columns.type')" @update:model-value="onTargetTypeChange" /></UFormField>
            <UFormField :label="t('access.audit.columns.target')" class="min-w-0"><USelect :model-value="filters.target_id ? String(filters.target_id) : allValue" :items="targetIdOptions" class="w-full" :disabled="!hydrated || !filters.target_type" :aria-label="t('access.audit.columns.target')" @update:model-value="onTargetIdChange" /></UFormField>
            <UFormField :label="t('access.audit.columns.action')" class="min-w-0"><USelect :model-value="filters.action ?? allValue" :items="actionSelectOptions" class="w-full" :disabled="!hydrated" :aria-label="t('access.audit.columns.action')" @update:model-value="onActionChange" /></UFormField>
          </template>
          <template #active>
            <div v-if="activeFilterCount" class="flex flex-wrap items-center gap-2">
              <UBadge v-if="filters.from" color="neutral" variant="subtle">{{ filters.from }}</UBadge>
              <UBadge v-if="filters.to" color="neutral" variant="subtle">{{ filters.to }}</UBadge>
              <UBadge v-if="filters.actor_id" color="neutral" variant="subtle">{{ actors.data.value?.items.find(actor => actor.id === filters.actor_id)?.name ?? t('access.audit.columns.actor') }}</UBadge>
              <UBadge v-if="filters.target_type" color="neutral" variant="subtle">{{ filters.target_type === 'role' ? t('access.roles.title') : t('access.users.title') }}</UBadge>
              <UBadge v-if="filters.target_id" color="neutral" variant="subtle">{{ targetOptions.find(target => target.id === filters.target_id)?.name ?? t('access.audit.columns.target') }}</UBadge>
              <UBadge v-if="filters.action" color="neutral" variant="subtle">{{ t(actionLabels[filters.action as keyof typeof actionLabels]) }}</UBadge>
            </div>
          </template>
        </FilterBar>
      </div>
      <div id="results" class="nasq-settings-anchor">
        <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && query.data.value?.items.length === 0" :empty-text="t('access.audit.empty')" @retry="query.refetch"><AuditTable :events="query.data.value?.items ?? []" @open="(id) => navigateTo({ path: `/settings/access-log/${id}`, query: route.query })" /></SharedPageState>
        <div v-if="pages > 1" class="nasq-settings-pagination">
          <UButton color="neutral" variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" :label="t('access.previousPage')" @click="previousPage" />
          <span>{{ t('access.pageOf', { page, pages }) }}</span>
          <UButton color="neutral" variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" :label="t('access.nextPage')" @click="nextPage" />
        </div>
      </div>
    </div>
  </SettingsLayout>
</template>
