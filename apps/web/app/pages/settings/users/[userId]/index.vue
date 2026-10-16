<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { accessBadge } from '@/components/access/accessBadge'
import type { PermissionDefinition } from '@webvue/contracts'
import { adminListQuery } from '@/composables/adminSettingsPaths'
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.userId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const sourcePaths = useRecordListPaths(['/settings/users'])
const returnTo = computed(() => router.resolve(owningListBack({ ...adminListQuery(route.query, ['q', 'status', 'role_id', 'department_id', 'offset']), returnTo: route.query.returnTo ?? null }, sourcePaths.value, route.hash)).fullPath)
const accessTo = computed(() => recordChildTo(`/settings/users/${id.value}/access`, route.query, sourcePaths.value, route.hash))
const securityTo = computed(() => recordChildTo(`/settings/users/${id.value}/security`, route.query, sourcePaths.value, route.hash))
const forbidden = computed(() => !can('access.users.read'))
const query = useAdminUser(computed(() => validId.value ? id.value : null), computed(() => !forbidden.value))
const pageError = computed(() => query.error.value ?? (validId.value || forbidden.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value && can('access.roles.read')))
const permissionLabels = computed(() => new Map<string, PermissionDefinition['label']>((catalog.data.value?.items ?? []).map((permission) => [permission.key, permission.label])))
const permissionLabel = (key: string) => permissionLabels.value.get(key)?.[locale.value === 'ar' ? 'ar' : 'en'] ?? permissionLabels.value.get(key)?.ar ?? t('access.roles.unknownPermission')
const sourceLabel = (source: { role: { name: { ar: string; en: string | null } } }) => source.role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? source.role.name.ar
const tabs = computed(() => {
  const user = query.data.value
  const actions = user?.allowed_actions ?? []
  return [
    { key: 'user-tab-account', label: t('access.users.account'), to: { path: route.path, query: route.query, hash: '' }, active: true },
    ...(actions.includes('assign_roles') ? [{ key: 'user-tab-access', label: t('access.users.editAccess'), to: accessTo.value, active: false }] : []),
    ...(actions.includes('reset_password') || actions.includes('disable') || actions.includes('reactivate')
      ? [{ key: 'user-tab-security', label: t('access.users.security'), to: securityTo.value, active: false }] : []),
    ...(can('access.audit.read') ? [{ key: 'user-tab-changes', label: t('access.users.changes'), to: `/settings/access-log?target_type=user&target_id=${id.value}`, active: false }] : []),
    ...(user?.employee && can('hr.employees.read') ? [{ key: 'user-tab-employee', label: t('access.users.employeeFile'), to: `/hr/employees/${user.employee.id}`, active: false }] : []),
  ]
})
</script>

<template>
  <SharedRecordPage :keep-content="!!query.data.value"
    data-testid="settings-layout"
    :title="query.data.value?.name ?? t('access.users.title')"
    :description="query.data.value?.login"
    :back-to="returnTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template #tabs><SharedRouteTabs :items="tabs" :ariaLabel="t('access.users.accountNavigation')" /></template>
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <SharedPageState v-else :empty="!query.data.value" :empty-text="t('access.notFound')">
      <template v-if="query.data.value">
        <SharedRecordSection id="roles" :title="t('access.users.rolesAndScopes')">
          <ul class="space-y-2 text-sm">
            <li v-for="assignment in query.data.value.assignments" :key="assignment.id">
              <span class="font-medium">{{ assignment.role.name[locale === 'ar' ? 'ar' : 'en'] ?? assignment.role.name.ar }}</span>
              <span class="block text-xs text-muted">{{ assignment.scope.name }}</span>
            </li>
          </ul>
          <p v-if="!query.data.value.assignments.length" class="text-sm text-muted">{{ t('access.users.noRoles') }}</p>
        </SharedRecordSection>
        <SharedRecordSection id="capabilities" :title="t('access.users.capabilities')">
          <ul class="space-y-2 text-sm">
            <li v-for="capability in query.data.value.capabilities" :key="capability.key">
              {{ permissionLabel(capability.key) }}
              <span v-if="capability.sources.length" class="block text-xs text-muted">{{ capability.sources.map(sourceLabel).join('، ') }}</span>
            </li>
          </ul>
        </SharedRecordSection>
      </template>
    </SharedPageState>
    <template v-if="query.data.value && !forbidden" #summary>
      <SharedPropertiesPanel id="account" :title="t('access.users.account')">
        <SharedPropertyRow :label="t('access.users.loginName')"><bdi dir="ltr">{{ query.data.value.login }}</bdi></SharedPropertyRow>
        <SharedPropertyRow :label="t('access.users.employee')" :value="query.data.value.employee?.name ?? t('access.users.noEmployee')" />
        <SharedPropertyRow :label="t('access.users.columns.status')">
          <SharedStatusBadge :tone="accessBadge({ active: query.data.value.active, protected: query.data.value.protected }).tone" :label="t(accessBadge({ active: query.data.value.active, protected: query.data.value.protected }).labelKey)" :icon="accessBadge({ active: query.data.value.active, protected: query.data.value.protected }).icon" />
        </SharedPropertyRow>
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
