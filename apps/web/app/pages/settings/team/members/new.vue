<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { queryPositiveInt } from '@/utils/routeQuery'
import MemberAddForm from '@/components/access/users/MemberAddForm.vue'
import { offerableRoles } from '@/components/access/memberRoles'
import { useMembershipBranches } from '@/composables/useMemberships'
import { useAdminRoles } from '@/composables/useAdminRoles'

// The route-backed create panel of member addition (Decision 2026-11-27), opened from a branch's members card. The
// branch comes in the query and must be one the branch list answers, so a stale or forged id finds no form. Nothing is
// fetched before the reader may grant members.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const canGrant = computed(() => can('access.users.grant'))
const canReadRoles = computed(() => can('access.roles.read'))
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/settings/team/branches', ['/settings/team/branches', '/settings/team/users']))
const memberBranches = useMembershipBranches(computed(() => canGrant.value))
const roles = useAdminRoles({}, computed(() => canGrant.value && canReadRoles.value))
const companyId = computed(() => {
  const parsed = queryPositiveInt(route.query.company_id)
  if (parsed === null) return null
  return (memberBranches.data.value?.items ?? []).some(branch => branch.id === parsed) ? parsed : null
})
</script>

<template>
  <SharedCreatePanel :title="t('access.members.addMember')" :back-to="backTo">
    <SharedForbiddenState v-if="!canGrant" :description="t('access.forbidden')" />
    <SharedNotFoundState v-else-if="companyId === null && !memberBranches.isLoading.value" :back-to="backTo" :back-label="t('access.branches.title')" />
    <MemberAddForm v-else-if="companyId" :company-id="companyId" :roles="offerableRoles(roles.data.value?.items ?? [], companyId)" @added="router.replace(backTo)" @cancel="router.push(backTo)" />
  </SharedCreatePanel>
</template>
