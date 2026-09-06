<script setup lang="ts">
import RolePermissionForm from '@/components/access/roles/RolePermissionForm.vue'
import { useAdminPermissionCatalog, useAdminRole } from '@/composables/useAdminRoles'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.roleId))
const returnTo = computed(() => {
  const query = new URLSearchParams()
  for (const key of ['q', 'type', 'status', 'offset']) if (route.query[key]) query.set(key, String(route.query[key]))
  const suffix = query.toString()
  return `/settings/roles${suffix ? `?${suffix}` : ''}`
})
const forbidden = computed(() => !can('access.roles.manage'))
const role = useAdminRole(id, computed(() => !forbidden.value && can('access.roles.read')))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value))
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-8">
    <SharedPageHeader :title="t('access.roles.editTitle')" :back-to="returnTo" />
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <SharedPageState v-else :loading="role.isLoading.value" :error="role.error.value" :empty="!role.data.value" :empty-text="t('access.notFound')" @retry="role.refetch">
      <section v-if="role.data.value" class="rounded-lg border border-border/80 bg-card p-4 sm:p-6"><RolePermissionForm :role="role.data.value" :permissions="catalog.data.value?.items ?? []" @saved="navigateTo(returnTo)" /></section>
    </SharedPageState>
  </div>
</template>
