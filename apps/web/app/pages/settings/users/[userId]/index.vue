<script setup lang="ts">
import type { PermissionDefinition } from '@nasq/contracts'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'
const route = useRoute()
const { t, locale } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.userId))
const returnTo = computed(() => {
  return adminPathWithQuery('/settings/users', adminListQuery(route.query, ['q', 'status', 'role_id', 'department_id', 'offset']))
})
const returnQuery = computed(() => returnTo.value.includes('?') ? `?${returnTo.value.split('?')[1]}` : '')
const accessTo = computed(() => `/settings/users/${id.value}/access${returnQuery.value}`)
const securityTo = computed(() => `/settings/users/${id.value}/security${returnQuery.value}`)
const forbidden = computed(() => !can('access.users.read'))
const query = useAdminUser(id, computed(() => !forbidden.value))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value && can('access.roles.read')))
const permissionLabels = computed(() => new Map<string, PermissionDefinition['label']>((catalog.data.value?.items ?? []).map((permission) => [permission.key, permission.label])))
const permissionLabel = (key: string) => permissionLabels.value.get(key)?.[locale.value === 'ar' ? 'ar' : 'en'] ?? permissionLabels.value.get(key)?.ar ?? t('access.roles.unknownPermission')
const sourceLabel = (source: { role: { name: { ar: string; en: string | null } } }) => source.role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? source.role.name.ar
</script>

<template>
  <SettingsLayout width="detail">
    <SharedPageHeader :title="query.data.value?.name ?? t('access.users.title')" :description="query.data.value?.login" :back-to="returnTo" />
    <nav class="flex flex-wrap gap-2 border-b border-default pb-2" :aria-label="t('access.users.accountNavigation')">
      <UButton color="neutral" variant="soft" :to="route.path" aria-current="page">{{ t('access.users.account') }}</UButton>
      <UButton color="neutral" variant="ghost" v-if="query.data.value?.allowed_actions.includes('assign_roles')" :to="accessTo">{{ t('access.users.editAccess') }}</UButton>
      <UButton color="neutral" variant="ghost" v-if="query.data.value?.allowed_actions.includes('reset_password') || query.data.value?.allowed_actions.includes('disable') || query.data.value?.allowed_actions.includes('reactivate')" :to="securityTo">{{ t('access.users.security') }}</UButton>
      <UButton color="neutral" variant="ghost" v-if="can('access.audit.read')" :to="`/settings/access-log?target_type=user&target_id=${id}`">{{ t('access.users.changes') }}</UButton>
      <UButton color="neutral" variant="ghost" v-if="query.data.value?.employee && can('hr.employees.read')" :to="`/hr/employees/${query.data.value.employee.id}`">{{ t('access.users.employeeFile') }}</UButton>
    </nav>
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && !query.data.value" :empty-text="t('access.notFound')" @retry="query.refetch">
      <div v-if="query.data.value" class="space-y-6">
        <UCard id="account" class="nasq-settings-anchor">
          <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('access.users.account') }}</h2></template>
          <div class="space-y-2 text-sm">
            <p>{{ t('access.users.login') }}: <span dir="ltr">{{ query.data.value.login }}</span></p>
            <p>{{ t('access.users.employee') }}: {{ query.data.value.employee?.name ?? t('access.users.noEmployee') }}</p>
            <AccessStateBadge :active="query.data.value.active" :protected="query.data.value.protected" />
          </div>
        </UCard>
        <UCard id="roles" class="nasq-settings-anchor">
          <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('access.users.rolesAndScopes') }}</h2></template>
          <ul class="space-y-2 text-sm"><li v-for="assignment in query.data.value.assignments" :key="assignment.id"><span class="font-medium">{{ assignment.role.name[locale === 'ar' ? 'ar' : 'en'] ?? assignment.role.name.ar }}</span><span class="block text-xs text-muted">{{ assignment.scope.name }}</span></li></ul>
          <p v-if="!query.data.value.assignments.length" class="text-sm text-muted">{{ t('access.users.noRoles') }}</p>
        </UCard>
        <UCard id="capabilities" class="nasq-settings-anchor">
          <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('access.users.capabilities') }}</h2></template>
          <ul class="space-y-2 text-sm"><li v-for="capability in query.data.value.capabilities" :key="capability.key">{{ permissionLabel(capability.key) }}<span v-if="capability.sources.length" class="block text-xs text-muted">{{ capability.sources.map(sourceLabel).join('، ') }}</span></li></ul>
        </UCard>
      </div>
    </SharedPageState>
  </SettingsLayout>
</template>
