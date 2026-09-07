<script setup lang="ts">
import RolePermissionForm from '@/components/access/roles/RolePermissionForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import UserTable from '@/components/access/users/UserTable.vue'
import { ApiError } from '@/composables/useApi'
import { useAdminUsers } from '@/composables/useAdminUsers'
import { useAdminPermissionCatalog, useAdminRole, useDeleteAdminRole, useDisableAdminRole, useEnableAdminRole } from '@/composables/useAdminRoles'
import { ADMIN_PAGE_SIZE, adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'

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
function requestAction(action: RoleAction) {
  if (!hydrated.value) return
  if (pendingAction.value === action) void confirmAction(action)
  else { pendingAction.value = action; actionError.value = '' }
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
  <SettingsLayout><div class="nasq-page-stack">
    <SharedPageHeader :title="role.data.value?.name[locale === 'ar' ? 'ar' : 'en'] ?? role.data.value?.name.ar ?? t('access.roles.title')" :back-to="returnTo">
      <Button v-if="role.data.value?.allowed_actions.includes('edit')" variant="outline" :disabled="!role.data.value" @click="navigateTo(editTo)">{{ t('access.roles.editTitle') }}</Button>
      <Button v-if="role.data.value?.allowed_actions.includes('clone')" variant="outline" :disabled="!role.data.value" @click="navigateTo(cloneTo)">{{ t('access.roles.clone') }}</Button>
      <Button v-if="role.data.value?.allowed_actions.includes('disable')" variant="outline" :disabled="!hydrated || actionBusy" @click="requestAction('disable')">{{ pendingAction === 'disable' ? t('access.roles.confirmAction') : t('access.roles.disable') }}</Button>
      <Button v-if="role.data.value?.allowed_actions.includes('enable')" variant="outline" :disabled="!hydrated || actionBusy" @click="requestAction('enable')">{{ pendingAction === 'enable' ? t('access.roles.confirmAction') : t('access.roles.enable') }}</Button>
      <Button v-if="role.data.value?.allowed_actions.includes('delete')" variant="destructive" :disabled="!hydrated || actionBusy" @click="requestAction('delete')">{{ pendingAction === 'delete' ? t('access.roles.confirmAction') : t('access.roles.delete') }}</Button>
    </SharedPageHeader>
    <nav class="nasq-tabs" :aria-label="t('access.roles.navigation')"><NuxtLink :to="route.path" aria-current="page">{{ t('access.roles.permissions') }}</NuxtLink><NuxtLink v-if="can('access.users.read')" to="#assigned-users">{{ t('access.roles.assignedUsers') }}</NuxtLink><NuxtLink v-if="can('access.audit.read')" :to="`/settings/access-log?target_type=role&target_id=${id}`">{{ t('access.roles.changes') }}</NuxtLink></nav>
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <p v-else-if="versionConflict" role="alert" class="text-sm text-destructive">{{ t('access.roles.conflict') }}</p>
    <SharedPageState v-else :loading="role.isLoading.value" :error="role.error.value" :empty="!role.data.value" :empty-text="t('access.notFound')" @retry="role.refetch">
      <section v-if="role.data.value" class="nasq-panel nasq-panel-body"><RolePermissionForm :role="role.data.value" :permissions="catalog.data.value?.items ?? []" :readonly="true" /></section>
      <p v-if="actionError" role="alert" class="text-sm text-destructive">{{ actionError }}</p>
      <section v-if="role.data.value && can('access.users.read')" id="assigned-users" class="min-w-0 space-y-3"><h2 class="text-lg font-semibold">{{ t('access.roles.assignedUsers') }}</h2><SharedPageState :loading="assignedUsers.isLoading.value" :error="assignedUsers.error.value" :empty="!assignedUsers.isLoading.value && !assignedUsers.error.value && assignedUsers.data.value?.items.length === 0" :empty-text="t('access.roles.noAssignedUsers')" @retry="assignedUsers.refetch"><UserTable :users="assignedUsers.data.value?.items ?? []" @open="openUser" /><template v-if="assignedUsers.data.value && assignedUsers.data.value.total > assignedUsers.data.value.items.length"><p class="text-sm text-muted-foreground">{{ t('access.roles.assignedUsersCount', { count: assignedUsers.data.value.total }) }}</p><NuxtLink class="text-sm font-medium text-primary hover:underline" :to="{ path: '/settings/users', query: { role_id: id } }">{{ t('access.roles.viewAllAssignedUsers') }}</NuxtLink></template></SharedPageState></section>
    </SharedPageState>
  </div></SettingsLayout>
</template>
