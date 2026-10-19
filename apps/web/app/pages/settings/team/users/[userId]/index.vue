<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { accessBadge } from '@/components/access/accessBadge'
import CapabilityGroups from '@/components/access/users/CapabilityGroups.vue'
import { adminListQuery } from '@/composables/adminSettingsPaths'
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.userId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const sourcePaths = useRecordListPaths(['/settings/team/users'])
const returnTo = computed(() => router.resolve(owningListBack({ ...adminListQuery(route.query, ['q', 'status', 'role_id', 'department_id', 'offset']), returnTo: route.query.returnTo ?? null }, sourcePaths.value, route.hash)).fullPath)
const accessTo = computed(() => recordChildTo(`/settings/team/users/${id.value}/access`, route.query, sourcePaths.value, route.hash))
const securityTo = computed(() => recordChildTo(`/settings/team/users/${id.value}/security`, route.query, sourcePaths.value, route.hash))
const forbidden = computed(() => !can('access.users.read'))
const query = useAdminUser(computed(() => validId.value ? id.value : null), computed(() => !forbidden.value))
const pageError = computed(() => query.error.value ?? (validId.value || forbidden.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value && can('access.roles.read')))
const badge = computed(() => accessBadge({ active: query.data.value?.active ?? false, protected: query.data.value?.protected }))
const tabs = computed(() => {
  const user = query.data.value
  const actions = user?.allowed_actions ?? []
  return [
    { key: 'user-tab-account', label: t('access.users.account'), to: { path: route.path, query: route.query, hash: '' }, active: true },
    ...(actions.includes('assign_roles') ? [{ key: 'user-tab-access', label: t('access.users.editAccess'), to: accessTo.value, active: false }] : []),
    ...(actions.includes('reset_password') || actions.includes('disable') || actions.includes('reactivate')
      ? [{ key: 'user-tab-security', label: t('access.users.security'), to: securityTo.value, active: false }] : []),
    ...(can('access.audit.read') ? [{ key: 'user-tab-changes', label: t('access.users.changes'), to: `/settings/team/access-log?target_type=user&target_id=${id.value}`, active: false }] : []),
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
        <SharedIdentityCard :id="query.data.value.id" :name="query.data.value.name">
          <template #badge><SharedStatusBadge size="sm" :tone="badge.tone" :label="t(badge.labelKey)" :icon="badge.icon" /></template>
          <template #subtitle><bdi dir="ltr">{{ query.data.value.login }}</bdi> · {{ query.data.value.employee?.name ?? t('access.users.noEmployee') }}</template>
        </SharedIdentityCard>
        <SharedRecordSection id="roles" variant="panel" :title="t('access.users.rolesAndScopes')">
          <ul v-if="query.data.value.assignments.length" class="grid gap-2">
            <SharedSubCard v-for="assignment in query.data.value.assignments" :key="assignment.id" as="li" class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-semibold text-highlighted">{{ assignment.role.name[locale === 'ar' ? 'ar' : 'en'] ?? assignment.role.name.ar }}</span>
              <SharedStatusBadge tone="neutral" size="sm" :label="assignment.scope.name" />
            </SharedSubCard>
          </ul>
          <p v-else class="text-sm text-muted">{{ t('access.users.noRoles') }}</p>
        </SharedRecordSection>
        <SharedRecordSection id="capabilities" variant="panel" :title="t('access.users.capabilities')">
          <CapabilityGroups :capabilities="query.data.value.capabilities" :permissions="catalog.data.value?.items" />
        </SharedRecordSection>
      </template>
    </SharedPageState>
    <template v-if="query.data.value && !forbidden" #aside>
      <SharedPropertiesPanel id="account" :title="t('access.users.account')">
        <SharedPropertyRow :label="t('access.users.loginName')"><bdi dir="ltr">{{ query.data.value.login }}</bdi></SharedPropertyRow>
        <SharedPropertyRow :label="t('access.users.employee')" :value="query.data.value.employee?.name ?? t('access.users.noEmployee')" />
        <SharedPropertyRow :label="t('access.users.columns.status')">
          <SharedStatusBadge size="sm" :tone="badge.tone" :label="t(badge.labelKey)" :icon="badge.icon" />
        </SharedPropertyRow>
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
