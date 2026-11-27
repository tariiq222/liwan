<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { queryPositiveInt } from '@/utils/routeQuery'
import MemberRolesForm from '@/components/access/users/MemberRolesForm.vue'
import { useMemberships } from '@/composables/useMemberships'
import { useAdminRoles } from '@/composables/useAdminRoles'

// The member's own role editing page (Decision 2026-11-27), reached from the members cards. The member is found in the
// same list the card drew it from, and nothing is fetched before the reader may change roles and the id is a positive
// integer.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const memberId = computed(() => queryPositiveInt(route.params.memberId))
const companyId = computed(() => queryPositiveInt(route.query.company_id))
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/settings/team/users', ['/settings/team/users', '/settings/team/branches']))
const canEdit = computed(() => can('access.users.grant') && can('access.users.assign_roles') && can('access.roles.read'))
const enabled = computed(() => canEdit.value && memberId.value !== null)
const list = useMemberships(() => companyId.value ?? undefined, enabled)
const roles = useAdminRoles({}, enabled)
const member = computed(() => list.data.value?.items.find(item => item.id === memberId.value) ?? null)

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
    <SharedNotFoundState v-else-if="!member && !list.isLoading.value" :back-to="backTo" />
    <MemberRolesForm v-else-if="member" :key="`${member.id}-${member.version}`" :member="member" :roles="roles.data.value?.items ?? []" :company-id="companyId ?? undefined" :reload-member="reloadMember" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
  </SharedPageContainer>
</template>
