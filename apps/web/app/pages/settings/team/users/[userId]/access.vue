<script setup lang="ts">
import UserAccessForm from '@/components/access/users/UserAccessForm.vue'
import { useAdminPermissionCatalog, useAdminRoles } from '@/composables/useAdminRoles'
import { recordParentTo } from '@/utils/recordListOrigin'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.userId))
const sourcePaths = useRecordListPaths(['/settings/team/users'])
const backTo = computed(() => recordParentTo(`/settings/team/users/${id.value}`, route.query, sourcePaths.value, route.hash))
const forbidden = computed(() => !can('access.users.assign_roles'))
const user = useAdminUser(id, computed(() => !forbidden.value && can('access.users.read')))
const roles = useAdminRoles({}, computed(() => !forbidden.value && can('access.roles.read')))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value && can('access.roles.read')))
function retryAccessData() {
  void Promise.all([user.refetch(), roles.refetch(), catalog.refetch()])
}
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('access.users.editAccess')" :back-to="backTo" />
    <UButton v-if="!forbidden && can('access.roles.read')" :to="`/settings/team/users/${id}/branches`" color="neutral" variant="outline" :label="t('access.branches.delegation')" />
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <SharedPageState v-else :loading="user.isLoading.value || roles.isLoading.value || catalog.isLoading.value" :error="user.error.value || roles.error.value || catalog.error.value" :empty="!user.data.value" :empty-text="t('access.notFound')" @retry="retryAccessData">
      <UserAccessForm v-if="user.data.value" :user="user.data.value" :roles="roles.data.value?.items ?? []" :permissions="catalog.data.value?.items ?? []" :permissions-loading="catalog.isLoading.value" :permissions-error="catalog.error.value" :cancel-to="backTo" @saved="navigateTo(backTo)" @retry="retryAccessData" />
    </SharedPageState>
  </SharedSettingsPage>
</template>
