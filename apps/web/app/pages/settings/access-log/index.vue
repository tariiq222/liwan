<script setup lang="ts">
import type { AuditAction } from '@nasq/contracts'
import AuditTable from '@/components/access/audit/AuditTable.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
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
function updateFilters() { filters.offset = 0; void router.replace({ query: { ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}), ...(filters.actor_id ? { actor_id: filters.actor_id } : {}), ...(filters.target_type ? { target_type: filters.target_type } : {}), ...(filters.target_id ? { target_id: filters.target_id } : {}), ...(filters.action ? { action: filters.action } : {}) } }) }
function syncPage() { void router.replace({ query: adminQueryWithOffset(route.query, filters.offset ?? 0) }) }
function previousPage() { if (hydrated.value) { filters.offset = Math.max(0, (filters.offset ?? 0) - (filters.limit ?? ADMIN_PAGE_SIZE)); syncPage() } }
function nextPage() { if (hydrated.value && page.value < pages.value) { filters.offset = (filters.offset ?? 0) + (filters.limit ?? ADMIN_PAGE_SIZE); syncPage() } }
watch(() => [route.query.from, route.query.to, route.query.actor_id, route.query.target_type, route.query.target_id, route.query.action, route.query.offset], ([from, to, actorId, targetType, targetId, action, offset]) => { filters.from = String(from ?? '') || undefined; filters.to = String(to ?? '') || undefined; filters.actor_id = actorId ? Number(actorId) : undefined; filters.target_type = targetType === 'role' ? 'role' : targetType === 'user' ? 'user' : undefined; filters.target_id = targetId ? Number(targetId) : undefined; filters.action = actionOptions.includes(String(action) as AuditAction) ? String(action) : undefined; filters.offset = parseAdminOffset(offset) })
const sections = computed(() => forbidden.value ? [] : [
  { id: 'filters', label: t('settings.toc.filters') },
  { id: 'results', label: t('settings.toc.list') },
])
</script>

<template>
  <SettingsLayout :sections>
    <SharedPageHeader :title="t('access.audit.title')" />
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <div v-else class="nasq-panel">
      <p class="px-6 pt-6 text-sm leading-6 text-muted-foreground">{{ t('access.audit.description') }}</p>
      <div id="filters" class="nasq-settings-filters nasq-settings-anchor"><label class="nasq-settings-field"><span>{{ t('access.audit.filters.from') }}</span><Input v-model="filters.from" type="date" :disabled="!hydrated" :aria-label="t('access.audit.filters.from')" @change="updateFilters" /></label><label class="nasq-settings-field"><span>{{ t('access.audit.filters.to') }}</span><Input v-model="filters.to" type="date" :disabled="!hydrated" :aria-label="t('access.audit.filters.to')" @change="updateFilters" /></label><label class="nasq-settings-field"><span>{{ t('access.audit.columns.actor') }}</span><select v-model="filters.actor_id" :disabled="!hydrated || actors.isLoading.value" class="h-[40px] rounded-lg border border-input bg-background px-3 text-sm" @change="updateFilters"><option :value="undefined">{{ t('access.audit.filters.allActors') }}</option><option v-for="actor in actors.data.value?.items ?? []" :key="actor.id" :value="actor.id">{{ actor.name }}</option></select></label><label class="nasq-settings-field"><span>{{ t('access.roles.columns.type') }}</span><select v-model="filters.target_type" :disabled="!hydrated" class="h-[40px] rounded-lg border border-input bg-background px-3 text-sm" @change="filters.target_id = undefined; updateFilters()"><option :value="undefined">{{ t('access.audit.filters.allTargets') }}</option><option value="user">{{ t('access.users.title') }}</option><option value="role">{{ t('access.roles.title') }}</option></select></label><label class="nasq-settings-field"><span>{{ t('access.audit.columns.target') }}</span><select v-model="filters.target_id" :disabled="!hydrated || !filters.target_type" class="h-[40px] rounded-lg border border-input bg-background px-3 text-sm" @change="updateFilters"><option :value="undefined">{{ t('access.audit.filters.chooseTarget') }}</option><option v-for="target in targetOptions" :key="target.id" :value="target.id">{{ target.name }}</option></select></label><label class="nasq-settings-field"><span>{{ t('access.audit.columns.action') }}</span><select v-model="filters.action" :disabled="!hydrated" class="h-[40px] rounded-lg border border-input bg-background px-3 text-sm" @change="updateFilters"><option :value="undefined">{{ t('access.audit.filters.allActions') }}</option><option v-for="action in actionOptions" :key="action" :value="action">{{ t(actionLabels[action]) }}</option></select></label><div class="nasq-settings-filter-actions"><Button variant="outline" :disabled="!hydrated" @click="filters.from = undefined; filters.to = undefined; filters.actor_id = undefined; filters.target_type = undefined; filters.action = undefined; filters.target_id = undefined; updateFilters()">{{ t('access.clearFilters') }}</Button></div></div>
      <div id="results" class="nasq-settings-anchor">
      <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && query.data.value?.items.length === 0" :empty-text="t('access.audit.empty')" @retry="query.refetch"><AuditTable :events="query.data.value?.items ?? []" @open="(id) => navigateTo({ path: `/settings/access-log/${id}`, query: route.query })" /></SharedPageState>
      <div v-if="pages > 1" class="nasq-settings-pagination"><Button variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" @click="previousPage">{{ t('access.previousPage') }}</Button><span>{{ t('access.pageOf', { page, pages }) }}</span><Button variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" @click="nextPage">{{ t('access.nextPage') }}</Button></div>
      </div>
    </div>
  </SettingsLayout>
</template>
