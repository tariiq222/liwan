<script setup lang="ts">
import UserAccessForm from '@/components/access/users/UserAccessForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { useAdminPermissionCatalog, useAdminRoles } from '@/composables/useAdminRoles'
import { adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.userId))
const backTo = computed(() => adminPathWithQuery(`/settings/users/${id.value}`, adminListQuery(route.query, ['q', 'status', 'role_id', 'department_id', 'offset'])))
const forbidden = computed(() => !can('access.users.assign_roles'))
const user = useAdminUser(id, computed(() => !forbidden.value && can('access.users.read')))
const roles = useAdminRoles({}, computed(() => !forbidden.value && can('access.roles.read')))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value && can('access.roles.read')))
function retryAccessData() {
  void Promise.all([user.refetch(), roles.refetch(), catalog.refetch()])
}
</script>

<template>
  <SettingsLayout><div class="nasq-page-stack nasq-settings-form-page">
    <SharedPageHeader :title="t('access.users.editAccess')" :back-to="backTo" />
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
      <SharedPageState v-else :loading="user.isLoading.value || roles.isLoading.value || catalog.isLoading.value" :error="user.error.value || roles.error.value || catalog.error.value" :empty="!user.data.value" :empty-text="t('access.notFound')" @retry="retryAccessData">
      <section v-if="user.data.value" class="nasq-panel nasq-panel-body"><UserAccessForm :user="user.data.value" :roles="roles.data.value?.items ?? []" :permissions="catalog.data.value?.items ?? []" :permissions-loading="catalog.isLoading.value" :permissions-error="catalog.error.value" @saved="navigateTo(backTo)" @retry="retryAccessData" /></section>
    </SharedPageState>
  </div></SettingsLayout>
</template>
