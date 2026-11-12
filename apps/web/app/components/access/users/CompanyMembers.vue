<script setup lang="ts">
import type { Membership } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useMemberships, useRemoveMembership, useUpdateMembershipRoles } from '@/composables/useMemberships'
import { accessErrorMessage } from '@/utils/accessErrors'
import RoleCheckboxes from '@/components/access/users/RoleCheckboxes.vue'
import { heldRoleOptions, type RoleCandidate } from '@/components/access/memberRoles'

// The members of a company whose account belongs to another company, with the roles they hold here. `companyId` names a
// branch below the working company (the root company managing it); without it the list is the working company's.
const props = defineProps<{ roles: RoleCandidate[]; companyId?: number }>()
const { t, locale } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const hydrated = useHydrated()
const canGrant = computed(() => can('access.users.grant'))
const canAssign = computed(() => can('access.users.assign_roles'))
// Changing roles offers the company's roles, so it needs to read them as well as to assign them.
const canChangeRoles = computed(() => canAssign.value && can('access.roles.read'))
// A member who holds roles here is removed only by someone who may also take those roles away.
const canRemove = (member: Membership) => canGrant.value && (canAssign.value || member.assignments.length === 0)
const targetCompanyId = computed(() => props.companyId ?? me.value?.company.id)
const list = useMemberships(() => props.companyId, canGrant)
const update = useUpdateMembershipRoles()
const remove = useRemoveMembership()
const items = computed(() => list.data.value?.items ?? [])
const editing = ref<{ id: number; roleIds: number[] } | null>(null)
const removing = ref<Membership | null>(null)
const message = ref('')
const busy = computed(() => update.isPending.value || remove.isPending.value)
const optionsFor = (member: Membership) => heldRoleOptions(
  props.roles,
  targetCompanyId.value,
  member.assignments.flatMap(({ role }) => role.id === null ? [] : [{ id: role.id, name: role.name }]),
  editing.value?.roleIds ?? [],
  t('access.roles.disabledExistingAssignments'),
)
const roleLabel = (role: { name: { ar: string; en: string | null } }) => role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar
const roleIdsOf = (member: Membership) => member.assignments.map(assignment => assignment.role.id).filter((id): id is number => id !== null)

function startEdit(member: Membership) {
  message.value = ''
  removing.value = null
  editing.value = { id: member.id, roleIds: roleIdsOf(member) }
}
function startRemove(member: Membership) {
  message.value = ''
  editing.value = null
  removing.value = member
}
async function saveRoles(member: Membership) {
  const draft = editing.value
  const company = targetCompanyId.value
  if (!draft || draft.id !== member.id || !company || !hydrated.value || busy.value) return
  message.value = ''
  try {
    await update.mutateAsync({
      id: member.id,
      body: {
        expected_version: member.version,
        assignments: draft.roleIds.map(role_id => ({ role_id, scope: { kind: 'company' as const, id: company } })),
        ...(props.companyId ? { company_id: props.companyId } : {}),
      },
    })
    editing.value = null
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 409 && cause.code === 'conflict') {
      // Someone else changed this member's roles: show the latest ones and let the administrator decide again.
      editing.value = null
      message.value = t('access.members.conflict')
      await list.refetch()
    } else message.value = accessErrorMessage(cause, t)
  }
}
async function confirmRemove() {
  const member = removing.value
  if (!member || !canRemove(member) || !hydrated.value || busy.value) return
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
    <SharedPageState :loading="list.isLoading.value" :error="list.error.value" :empty="!items.length" :empty-text="t('access.members.empty')" @retry="list.refetch">
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
            <div v-if="editing?.id !== member.id && removing?.id !== member.id" class="flex flex-wrap gap-2">
              <UButton v-if="canChangeRoles" size="sm" color="neutral" variant="outline" :label="t('access.members.changeRoles')" :disabled="!hydrated || busy" data-testid="member-change-roles" @click="startEdit(member)" />
              <UButton v-if="canRemove(member)" size="sm" color="neutral" variant="outline" :label="t('access.members.remove')" :disabled="!hydrated || busy" data-testid="member-remove" @click="startRemove(member)" />
            </div>
          </div>
          <form v-if="editing?.id === member.id" class="mt-3 grid gap-3" @submit.prevent="saveRoles(member)">
            <RoleCheckboxes v-model="editing.roleIds" :roles="optionsFor(member)" :legend="t('access.members.rolesIn', { company: member.company.name })" :empty-text="t('access.members.noRoles')" :disabled="!hydrated || busy" />
            <SharedFormActions>
              <div class="ms-auto flex flex-wrap items-center gap-2">
                <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" :disabled="busy" @click="editing = null" />
                <UButton type="submit" color="primary" :label="t('access.members.saveRoles')" :loading="update.isPending.value" :disabled="!hydrated || busy" data-testid="member-save-roles" />
              </div>
            </SharedFormActions>
          </form>
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
