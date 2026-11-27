<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { ApiError } from '@/composables/useApi'
import { queryPositiveInt } from '@/utils/routeQuery'
import MemberAddForm from '@/components/access/users/MemberAddForm.vue'
import { offerableRoles } from '@/components/access/memberRoles'
import { useMembershipBranches } from '@/composables/useMemberships'
import { useAdminRoles } from '@/composables/useAdminRoles'

// The route-backed create panel of member addition (Decision 2026-11-27), opened from a branch's members card. The
// branch comes in the query and must be one the branch list answers, so a stale or forged id finds no form. Nothing is
// fetched before the reader may grant members and a valid branch id is present.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const canGrant = computed(() => can('access.users.grant'))
const canReadRoles = computed(() => can('access.roles.read'))
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/settings/team/branches', ['/settings/team/branches', '/settings/team/users']))
const requestedCompanyId = computed(() => queryPositiveInt(route.query.company_id))
const memberBranches = useMembershipBranches(computed(() => canGrant.value && requestedCompanyId.value !== null))
const companyId = computed(() => {
  const requested = requestedCompanyId.value
  if (requested === null) return null
  return (memberBranches.data.value?.items ?? []).some(branch => branch.id === requested) ? requested : null
})
const roles = useAdminRoles({}, computed(() => canGrant.value && canReadRoles.value && companyId.value !== null))
const loading = computed(() => memberBranches.isLoading.value || (companyId.value !== null && canReadRoles.value && roles.isLoading.value))
const pageError = computed(() => {
  if (requestedCompanyId.value === null) return new ApiError(404, 'not_found', t('access.notFound'))
  if (memberBranches.error.value) return memberBranches.error.value
  if (companyId.value !== null && canReadRoles.value && roles.error.value) return roles.error.value
  if (!memberBranches.isLoading.value && memberBranches.data.value && companyId.value === null) return new ApiError(404, 'not_found', t('access.notFound'))
  return null
})
function retry() {
  if (memberBranches.error.value) void memberBranches.refetch()
  if (roles.error.value) void roles.refetch()
}
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('access.branches.title')" :back-to="backTo" />
  </SharedSettingsPage>
  <SharedCreatePanel :title="t('access.members.addMember')" :back-to="backTo">
    <SharedForbiddenState v-if="!canGrant" :description="t('access.forbidden')" />
    <SharedPageState v-else :loading="loading" :error="pageError" @retry="retry">
      <MemberAddForm v-if="companyId !== null" :company-id="companyId" :roles="offerableRoles(roles.data.value?.items ?? [], companyId)" @added="router.replace(backTo)" @cancel="router.push(backTo)" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
