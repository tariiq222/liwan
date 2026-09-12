<script setup lang="ts">
import RolePermissionForm from '@/components/access/roles/RolePermissionForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { useAdminPermissionCatalog, useAdminRole } from '@/composables/useAdminRoles'
import { adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.roleId))
// An edit form returns to the role it edits, not past it to the list, and
// carries the list filters through so the role's own back control still lands
// on the list the reader came from.
const backTo = computed(() => {
  return adminPathWithQuery(`/settings/roles/${id.value}`, adminListQuery(route.query, ['q', 'type', 'status', 'offset']))
})
const forbidden = computed(() => !can('access.roles.manage'))
const role = useAdminRole(id, computed(() => !forbidden.value && can('access.roles.read')))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value))
</script>

<template>
  <SettingsLayout width="form">
    <SharedPageHeader :title="t('access.roles.editTitle')" :back-to="backTo" />
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <SharedPageState v-else :loading="role.isLoading.value" :error="role.error.value" :empty="!role.data.value" :empty-text="t('access.notFound')" @retry="role.refetch">
      <UCard v-if="role.data.value" class="nasq-ui-record-surface" :ui="{ body: 'p-5 sm:p-6' }"><RolePermissionForm :role="role.data.value" :permissions="catalog.data.value?.items ?? []" @saved="navigateTo(backTo)" /></UCard>
    </SharedPageState>
  </SettingsLayout>
</template>
