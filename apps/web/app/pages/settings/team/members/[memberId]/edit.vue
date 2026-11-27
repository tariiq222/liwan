<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { ApiError } from '@/composables/useApi'
import { queryPositiveInt } from '@/utils/routeQuery'
import MemberRolesForm from '@/components/access/users/MemberRolesForm.vue'
import { useMemberships } from '@/composables/useMemberships'
import { useAdminRoles } from '@/composables/useAdminRoles'

// The member's own role editing page (Decision 2026-11-27), reached from the members cards. The member is found in the
// same list the card drew it from, and nothing is fetched before the reader may change roles and the route ids are valid.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const memberId = computed(() => queryPositiveInt(route.params.memberId))
const rawCompanyId = computed(() => route.query.company_id)
const companyId = computed(() => queryPositiveInt(rawCompanyId.value))
const invalidCompanyId = computed(() => rawCompanyId.value !== undefined && rawCompanyId.value !== '' && companyId.value === null)
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/settings/team/users', ['/settings/team/users', '/settings/team/branches']))
const canEdit = computed(() => can('access.users.grant') && can('access.users.assign_roles') && can('access.roles.read'))
const enabled = computed(() => canEdit.value && memberId.value !== null && !invalidCompanyId.value)
const list = useMemberships(() => companyId.value ?? undefined, enabled)
const roles = useAdminRoles({}, enabled)
const member = computed(() => (memberId.value === null ? null : list.data.value?.items.find(item => item.id === memberId.value) ?? null))
const loading = computed(() => list.isLoading.value || roles.isLoading.value)
const pageError = computed(() => {
  if (memberId.value === null || invalidCompanyId.value) return new ApiError(404, 'not_found', t('access.notFound'))
  if (list.error.value) return list.error.value
  if (roles.error.value) return roles.error.value
  if (!list.isLoading.value && list.data.value && !member.value) return new ApiError(404, 'not_found', t('access.notFound'))
  return null
})

function retry() {
  if (list.error.value) void list.refetch()
  if (roles.error.value) void roles.refetch()
}

async function reloadMember() {
  const result = await list.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="member?.name ?? t('access.members.changeRoles')" :back-to="backTo" />
    <SharedForbiddenState v-if="!canEdit" :description="t('access.forbidden')" />
    <SharedPageState v-else :loading="loading" :error="pageError" @retry="retry">
      <MemberRolesForm v-if="member" :key="`${member.id}-${member.version}`" :member="member" :roles="roles.data.value?.items ?? []" :company-id="companyId ?? undefined" :reload-member="reloadMember" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
    </SharedPageState>
  </SharedPageContainer>
</template>
