<script setup lang="ts">
import RolePermissionForm from '@/components/access/roles/RolePermissionForm.vue'
import UserTable from '@/components/access/users/UserTable.vue'
import { ApiError } from '@/composables/useApi'
import { useAdminUsers } from '@/composables/useAdminUsers'
import { useAdminPermissionCatalog, useAdminRole, useDeleteAdminRole, useDisableAdminRole, useEnableAdminRole } from '@/composables/useAdminRoles'
import { ADMIN_PAGE_SIZE, adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'
import { accessStateBadge } from '@/utils/accessStateBadge'

const route = useRoute()
const { t, locale } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.roleId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const returnTo = computed(() => {
  return adminPathWithQuery('/settings/roles', adminListQuery(route.query, ['q', 'type', 'status', 'offset']))
})
const returnQuery = computed(() => returnTo.value.includes('?') ? `?${returnTo.value.split('?')[1]}` : '')
const editTo = computed(() => `/settings/roles/${id.value}/edit${returnQuery.value}`)
const cloneTo = computed(() => `/settings/roles/new?clone=${id.value}${returnQuery.value ? `&${returnQuery.value.slice(1)}` : ''}`)
const forbidden = computed(() => !can('access.roles.read'))
const role = useAdminRole(computed(() => validId.value ? id.value : null), computed(() => !forbidden.value))
const pageError = computed(() => role.error.value ?? (validId.value || forbidden.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value))
const assignedUsers = useAdminUsers(computed(() => ({ role_id: id.value, limit: ADMIN_PAGE_SIZE, offset: 0 })), computed(() => validId.value && !forbidden.value && can('access.users.read')))
const disable = useDisableAdminRole()
const enable = useEnableAdminRole()
const remove = useDeleteAdminRole()
type RoleAction = 'disable' | 'enable' | 'delete'
const pendingAction = ref<RoleAction | null>(null)
const actionError = ref('')
const versionConflict = computed(() => (role.error.value as { code?: string } | null)?.code === 'conflict')
const actionBusy = computed(() => disable.isPending.value || enable.isPending.value || remove.isPending.value)
const confirmColor = computed(() => pendingAction.value === 'delete' ? 'error' as const : pendingAction.value === 'disable' ? 'warning' as const : 'primary' as const)
function requestAction(action: RoleAction) {
  if (!hydrated.value) return
  pendingAction.value = action
  actionError.value = ''
}
async function confirmAction(action: RoleAction) {
  if (!role.data.value || actionBusy.value) return
  try {
    if (action === 'disable') await disable.mutateAsync({ id: role.data.value.id, body: { expected_version: role.data.value.version } })
    if (action === 'enable') await enable.mutateAsync({ id: role.data.value.id, body: { expected_version: role.data.value.version } })
    if (action === 'delete') { await remove.mutateAsync({ id: role.data.value.id, expected_version: role.data.value.version }); await navigateTo('/settings/roles'); return }
    pendingAction.value = null
  } catch (error) {
    pendingAction.value = null
    if (error instanceof ApiError) {
      const translated = `access.errors.${error.code}`
      actionError.value = error.code && t(translated) !== translated ? t(translated) : (error.message || t('errors.generic'))
    } else actionError.value = t('errors.generic')
  }
}
const roleName = computed(() => role.data.value?.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.data.value?.name.ar ?? t('access.roles.title'))
const tabs = computed(() => [
  { key: 'role-tab-permissions', label: t('access.roles.permissions'), to: { path: route.path, query: route.query, hash: '' }, active: true },
  ...(can('access.users.read') ? [{ key: 'role-tab-users', label: t('access.roles.assignedUsers'), to: '#assigned-users', active: false }] : []),
  ...(can('access.audit.read') ? [{ key: 'role-tab-changes', label: t('access.roles.changes'), to: `/settings/access-log?target_type=role&target_id=${id.value}`, active: false }] : []),
])
const userTo = (user: { id: number }) => ({ path: `/settings/users/${user.id}`, query: { role_id: String(id.value) } })
const typeLabel = computed(() => role.data.value?.type === 'built_in' ? t('access.roles.builtIn') : t('access.roles.custom'))
</script>

<template>
  <SharedRecordPage
    data-testid="settings-layout"
    :title="roleName"
    :back-to="returnTo"
    :loading="role.isLoading.value"
    :error="versionConflict ? null : pageError"
    @retry="role.refetch"
  >
    <template #actions>
      <UButton v-if="role.data.value?.allowed_actions.includes('edit')" color="neutral" variant="outline" icon="i-lucide-pencil" :disabled="!role.data.value" :label="t('access.roles.editTitle')" @click="navigateTo(editTo)" />
      <UButton v-if="role.data.value?.allowed_actions.includes('clone')" color="neutral" variant="outline" icon="i-lucide-copy" :disabled="!role.data.value" :label="t('access.roles.clone')" @click="navigateTo(cloneTo)" />
      <UButton v-if="role.data.value?.allowed_actions.includes('disable')" color="neutral" variant="outline" :disabled="!hydrated || actionBusy || pendingAction !== null" :label="t('access.roles.disable')" @click="requestAction('disable')" />
      <UButton v-if="role.data.value?.allowed_actions.includes('enable')" color="neutral" variant="outline" :disabled="!hydrated || actionBusy || pendingAction !== null" :label="t('access.roles.enable')" @click="requestAction('enable')" />
      <UButton v-if="role.data.value?.allowed_actions.includes('delete')" color="error" variant="outline" icon="i-lucide-trash-2" :disabled="!hydrated || actionBusy || pendingAction !== null" :label="t('access.roles.delete')" @click="requestAction('delete')" />
    </template>
    <template #tabs><SharedRouteTabs :items="tabs" :ariaLabel="t('access.roles.navigation')" /></template>
    <SharedInlineConfirm
      v-if="pendingAction && role.data.value"
      :color="confirmColor"
      :title="t(`access.roles.confirm.${pendingAction}.title`)"
      :description="t(`access.roles.confirm.${pendingAction}.description`)"
      :confirm-label="t('access.roles.confirmAction')"
      :pending="actionBusy"
      @confirm="confirmAction(pendingAction)"
      @cancel="pendingAction = null"
    />
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <UAlert v-else-if="versionConflict" role="alert" color="error" variant="subtle" :title="t('access.roles.conflict')" />
    <SharedPageState v-else :empty="!role.data.value" :empty-text="t('access.notFound')">
      <template v-if="role.data.value">
        <RolePermissionForm id="permissions" :role="role.data.value" :permissions="catalog.data.value?.items ?? []" :readonly="true" />
        <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" />
        <SharedRecordSection v-if="can('access.users.read')" id="assigned-users" :title="t('access.roles.assignedUsers')">
          <UserTable
            :users="assignedUsers.data.value?.items ?? []"
            :loading="assignedUsers.isLoading.value"
            :error="assignedUsers.error.value"
            :empty-text="t('access.roles.noAssignedUsers')"
            :to-for="userTo"
            @retry="assignedUsers.refetch"
          />
          <template v-if="assignedUsers.data.value && assignedUsers.data.value.total > assignedUsers.data.value.items.length">
            <p class="text-sm text-muted">{{ t('access.roles.assignedUsersCount', { count: assignedUsers.data.value.total }, assignedUsers.data.value.total) }}</p>
            <UButton color="primary" variant="link" class="p-0" :to="{ path: '/settings/users', query: { role_id: id } }" :label="t('access.roles.viewAllAssignedUsers')" />
          </template>
        </SharedRecordSection>
      </template>
    </SharedPageState>
    <template v-if="role.data.value && !forbidden" #aside>
      <SharedPropertiesPanel :title="t('access.roles.details')">
        <SharedPropertyRow :label="t('access.roles.columns.type')" :value="typeLabel" />
        <SharedPropertyRow :label="t('access.roles.columns.status')">
          <SharedStatusBadge :tone="accessStateBadge({ active: role.data.value.active, protected: role.data.value.protected }).tone" :label="t(accessStateBadge({ active: role.data.value.active, protected: role.data.value.protected }).labelKey)" />
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('access.roles.columns.users')" :value="role.data.value.user_count" />
        <SharedPropertyRow :label="t('access.roles.columns.description')" :value="role.data.value.description" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
