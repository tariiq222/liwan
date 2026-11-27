<script setup lang="ts">
import type { Membership } from '@liwan/contracts'
import { useMemberships, useRemoveMembership } from '@/composables/useMemberships'
import { accessErrorMessage } from '@/utils/accessErrors'
import type { RoleCandidate } from '@/components/access/memberRoles'

// The members of a company whose account belongs to another company, with the roles they hold here. `companyId` names a
// branch below the working company (the root company managing it); without it the list is the working company's. Roles
// are changed on the member's own edit page (Decision 2026-11-27); removing keeps its inline confirm.
const props = defineProps<{ roles: RoleCandidate[]; companyId?: number }>()
const { t, locale } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canGrant = computed(() => can('access.users.grant'))
const canAssign = computed(() => can('access.users.assign_roles'))
// Changing roles offers the company's roles, so it needs to read them as well as to assign them.
const canChangeRoles = computed(() => canAssign.value && can('access.roles.read'))
// A member who holds roles here is removed only by someone who may also take those roles away.
const canRemove = (member: Membership) => canGrant.value && (canAssign.value || member.assignments.length === 0)
const list = useMemberships(() => props.companyId, canGrant)
const remove = useRemoveMembership()
const items = computed(() => list.data.value?.items ?? [])
const removing = ref<Membership | null>(null)
const message = ref('')
const roleLabel = (role: { name: { ar: string; en: string | null } }) => role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar
// The member edit page edits the same list this card drew the member from; the query keeps the branch's context.
const changeRolesTo = (member: Membership) => ({
  path: `/settings/team/members/${member.id}/edit`,
  query: {
    ...(props.companyId ? { company_id: String(props.companyId) } : {}),
    returnTo: props.companyId ? '/settings/team/branches#branch-members' : '/settings/team/users#members',
  },
})

function startRemove(member: Membership) {
  message.value = ''
  removing.value = member
}
async function confirmRemove() {
  const member = removing.value
  if (!member || !canRemove(member) || !hydrated.value || remove.isPending.value) return
  message.value = ''
  try {
    await remove.mutateAsync({ id: member.id, companyId: props.companyId })
    removing.value = null
  } catch (cause) {
    removing.value = null
    message.value = accessErrorMessage(cause, t)
  }
}
</script>

<template>
  <div v-if="canGrant" class="grid gap-3" data-testid="company-members">
    <UAlert v-if="message" role="alert" color="warning" variant="subtle" :title="message" />
    <SharedPageState empty-icon="i-lucide-users" :loading="list.isLoading.value" :error="list.error.value" :empty="!items.length" :empty-text="t('access.members.empty')" @retry="list.refetch">
      <ul class="grid gap-(--liwan-gap-card)">
        <SharedSubCard v-for="member in items" :key="member.id" as="li" :data-testid="`member-${member.id}`">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="grid min-w-0 gap-1">
              <span class="font-medium text-highlighted">{{ member.name }}</span>
              <span class="text-sm text-muted" dir="ltr">{{ member.login }}</span>
              <span class="text-sm text-muted">{{ t('access.members.homeCompany', { company: member.home_company.name }) }}</span>
              <ul v-if="member.assignments.length" class="flex flex-wrap gap-2">
                <li v-for="assignment in member.assignments" :key="assignment.id"><SharedStatusBadge tone="neutral" size="sm" :label="roleLabel(assignment.role)" /></li>
              </ul>
              <span v-else class="text-sm text-muted">{{ t('access.members.noRolesHere') }}</span>
            </div>
            <div v-if="removing?.id !== member.id" class="flex flex-wrap gap-2">
              <UButton v-if="canChangeRoles" size="sm" color="neutral" variant="outline" :label="t('access.members.changeRoles')" :to="changeRolesTo(member)" data-testid="member-change-roles" />
              <UButton v-if="canRemove(member)" size="sm" color="neutral" variant="outline" :label="t('access.members.remove')" :disabled="!hydrated || remove.isPending.value" data-testid="member-remove" @click="startRemove(member)" />
            </div>
          </div>
          <SharedInlineConfirm
            v-if="removing?.id === member.id"
            class="mt-3"
            :title="t('access.members.removeConfirm', { name: member.name, company: member.company.name })"
            :description="t('access.members.removeBody', { home: member.home_company.name })"
            :confirm-label="t('access.members.remove')"
            :pending="remove.isPending.value"
            @confirm="confirmRemove"
            @cancel="removing = null"
          />
        </SharedSubCard>
      </ul>
    </SharedPageState>
  </div>
</template>
