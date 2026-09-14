<script setup lang="ts">
import RolePermissionForm from '@/components/access/roles/RolePermissionForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import UserTable from '@/components/access/users/UserTable.vue'
import { ApiError } from '@/composables/useApi'
import { useAdminUsers } from '@/composables/useAdminUsers'
import { useAdminPermissionCatalog, useAdminRole, useDeleteAdminRole, useDisableAdminRole, useEnableAdminRole } from '@/composables/useAdminRoles'
import { ADMIN_PAGE_SIZE, adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'
import { routeTabClass, routeTabsStripClass } from '@/utils/sectionTabs'

const route = useRoute()
const { t, locale } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.roleId))
const returnTo = computed(() => {
  return adminPathWithQuery('/settings/roles', adminListQuery(route.query, ['q', 'type', 'status', 'offset']))
})
const returnQuery = computed(() => returnTo.value.includes('?') ? `?${returnTo.value.split('?')[1]}` : '')
const editTo = computed(() => `/settings/roles/${id.value}/edit${returnQuery.value}`)
const cloneTo = computed(() => `/settings/roles/new?clone=${id.value}${returnQuery.value ? `&${returnQuery.value.slice(1)}` : ''}`)
const forbidden = computed(() => !can('access.roles.read'))
const role = useAdminRole(id, computed(() => !forbidden.value))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value))
const assignedUsers = useAdminUsers(computed(() => ({ role_id: id.value, limit: ADMIN_PAGE_SIZE, offset: 0 })), computed(() => !forbidden.value && can('access.users.read')))
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
function openUser(userId: number) { void navigateTo(`/settings/users/${userId}?role_id=${id.value}`) }
</script>

<template>
  <SettingsLayout width="detail">
    <SharedPageHeader :title="role.data.value?.name[locale === 'ar' ? 'ar' : 'en'] ?? role.data.value?.name.ar ?? t('access.roles.title')" :back-to="returnTo">
      <UButton v-if="role.data.value?.allowed_actions.includes('edit')" color="neutral" variant="outline" icon="i-lucide-pencil" :disabled="!role.data.value" :label="t('access.roles.editTitle')" @click="navigateTo(editTo)" />
      <UButton v-if="role.data.value?.allowed_actions.includes('clone')" color="neutral" variant="outline" icon="i-lucide-copy" :disabled="!role.data.value" :label="t('access.roles.clone')" @click="navigateTo(cloneTo)" />
      <UButton v-if="role.data.value?.allowed_actions.includes('disable')" color="neutral" variant="outline" :disabled="!hydrated || actionBusy || pendingAction !== null" :label="t('access.roles.disable')" @click="requestAction('disable')" />
      <UButton v-if="role.data.value?.allowed_actions.includes('enable')" color="neutral" variant="outline" :disabled="!hydrated || actionBusy || pendingAction !== null" :label="t('access.roles.enable')" @click="requestAction('enable')" />
      <UButton v-if="role.data.value?.allowed_actions.includes('delete')" color="error" variant="outline" icon="i-lucide-trash-2" :disabled="!hydrated || actionBusy || pendingAction !== null" :label="t('access.roles.delete')" @click="requestAction('delete')" />
    </SharedPageHeader>
    <nav :class="routeTabsStripClass" :aria-label="t('access.roles.navigation')"><UButton color="neutral" variant="ghost" :class="routeTabClass" :to="route.path" aria-current="page">{{ t('access.roles.permissions') }}</UButton><UButton color="neutral" variant="ghost" :class="routeTabClass" v-if="can('access.users.read')" to="#assigned-users">{{ t('access.roles.assignedUsers') }}</UButton><UButton color="neutral" variant="ghost" :class="routeTabClass" v-if="can('access.audit.read')" :to="`/settings/access-log?target_type=role&target_id=${id}`">{{ t('access.roles.changes') }}</UButton></nav>
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
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <UAlert v-else-if="versionConflict" role="alert" color="error" variant="subtle" :title="t('access.roles.conflict')" />
    <SharedPageState v-else :loading="role.isLoading.value" :error="role.error.value" :empty="!role.data.value" :empty-text="t('access.notFound')" @retry="role.refetch">
      <div v-if="role.data.value" class="space-y-6">
        <UCard id="permissions" class="rounded-lg ring ring-default bg-default overflow-hidden nasq-settings-anchor"><RolePermissionForm :role="role.data.value" :permissions="catalog.data.value?.items ?? []" :readonly="true" /></UCard>
        <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" />
        <UCard v-if="can('access.users.read')" id="assigned-users" class="rounded-lg ring ring-default bg-default overflow-hidden nasq-settings-anchor min-w-0" :ui="{ header: '' }">
          <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('access.roles.assignedUsers') }}</h2></template>
          <SharedPageState :loading="assignedUsers.isLoading.value" :error="assignedUsers.error.value" :empty="!assignedUsers.isLoading.value && !assignedUsers.error.value && assignedUsers.data.value?.items.length === 0" :empty-text="t('access.roles.noAssignedUsers')" @retry="assignedUsers.refetch">
            <UserTable :users="assignedUsers.data.value?.items ?? []" @open="openUser" />
            <template v-if="assignedUsers.data.value && assignedUsers.data.value.total > assignedUsers.data.value.items.length">
              <p class="mt-3 text-sm text-muted">{{ t('access.roles.assignedUsersCount', { count: assignedUsers.data.value.total }) }}</p>
              <UButton color="primary" variant="link" class="p-0" :to="{ path: '/settings/users', query: { role_id: id } }" :label="t('access.roles.viewAllAssignedUsers')" />
            </template>
          </SharedPageState>
        </UCard>
      </div>
    </SharedPageState>
  </SettingsLayout>
</template>
