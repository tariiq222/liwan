<script setup lang="ts">
import RolePermissionForm from '@/components/access/roles/RolePermissionForm.vue'
import { useAdminPermissionCatalog, useAdminRole } from '@/composables/useAdminRoles'
import { recordParentTo } from '@/utils/recordListOrigin'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.roleId))
// An edit form returns to the role it edits, not past it to the list, and
// carries the list filters through so the role's own back control still lands
// on the list the reader came from.
const sourcePaths = useRecordListPaths(['/settings/team/roles'])
const backTo = computed(() => recordParentTo(`/settings/team/roles/${id.value}`, route.query, sourcePaths.value, route.hash))
const forbidden = computed(() => !can('access.roles.manage'))
const role = useAdminRole(id, computed(() => !forbidden.value && can('access.roles.read')))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value))
async function reloadRole() {
  const result = await role.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('access.roles.editTitle')" :back-to="backTo" />
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <SharedPageState v-else :loading="role.isLoading.value" :error="role.error.value" :empty="!role.data.value" :empty-text="t('access.notFound')" @retry="role.refetch">
      <RolePermissionForm v-if="role.data.value" :role="role.data.value" :permissions="catalog.data.value?.items ?? []" :reload-role="reloadRole" @saved="navigateTo(backTo)" />
    </SharedPageState>
  </SharedSettingsPage>
</template>
