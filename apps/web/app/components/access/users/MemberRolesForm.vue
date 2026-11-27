<script setup lang="ts">
import type { Membership } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useUpdateMembershipRoles } from '@/composables/useMemberships'
import { accessErrorMessage } from '@/utils/accessErrors'
import RoleCheckboxes from '@/components/access/users/RoleCheckboxes.vue'
import { heldRoleOptions, type RoleCandidate } from '@/components/access/memberRoles'

// The roles one member holds in a company, edited on the member's own edit page (Decision 2026-11-27). `companyId` names
// the branch the root company manages; without it the roles are the working company's.
const props = defineProps<{ member: Membership; roles: RoleCandidate[]; companyId?: number; reloadMember: () => Promise<unknown> }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const { me } = useMe()
const hydrated = useHydrated()
const update = useUpdateMembershipRoles()
const formId = useId()
// The assignments carry the roles' scope: the branch, or the working company itself.
const scopeCompanyId = computed(() => props.companyId ?? me.value?.company.id)
const roleIds = ref(props.member.assignments.map(({ role }) => role.id).filter((id): id is number => id !== null))
const originalIds = computed(() => props.member.assignments.map(({ role }) => role.id).filter((id): id is number => id !== null))
const saved = ref(false)
const dirty = computed(() => !saved.value && roleIds.value.slice().sort().join(',') !== originalIds.value.slice().sort().join(','))
const options = computed(() => heldRoleOptions(
  props.roles,
  scopeCompanyId.value,
  props.member.assignments.flatMap(({ role }) => role.id === null ? [] : [{ id: role.id, name: role.name }]),
  roleIds.value,
  t('access.roles.disabledExistingAssignments'),
))
const conflict = ref(false)
const reloading = ref(false)
const message = ref('')
const busy = computed(() => !hydrated.value || update.isPending.value || reloading.value || conflict.value)

async function saveRoles() {
  const company = scopeCompanyId.value
  if (!company || busy.value) return
  message.value = ''
  conflict.value = false
  try {
    await update.mutateAsync({
      id: props.member.id,
      body: {
        expected_version: props.member.version,
        assignments: roleIds.value.map(role_id => ({ role_id, scope: { kind: 'company' as const, id: company } })),
        ...(props.companyId ? { company_id: props.companyId } : {}),
      },
    })
    saved.value = true
    emit('done')
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 409 && cause.code === 'conflict') {
      // Someone else changed this member's roles: the draft is stale, so lock it behind a reload of the latest ones.
      conflict.value = true
    } else message.value = accessErrorMessage(cause, t)
  }
}

async function reloadDraft() {
  if (!hydrated.value || update.isPending.value || reloading.value) return
  reloading.value = true
  message.value = ''
  try {
    const list = (await props.reloadMember()) as { items?: Membership[] } | undefined
    // The page also remounts this form keyed by the member's new version; this reset keeps the draft honest even when
    // the version is unchanged.
    const latest = list?.items?.find(item => item.id === props.member.id) ?? props.member
    roleIds.value = latest.assignments.map(({ role }) => role.id).filter((id): id is number => id !== null)
    conflict.value = false
  } catch (cause) {
    // Keep the stale draft locked until a reload succeeds so it cannot overwrite newer roles.
    message.value = accessErrorMessage(cause, t)
  } finally {
    reloading.value = false
  }
}
</script>

<template>
  <form :id="formId" class="liwan-form" novalidate data-testid="member-roles-form" @submit.prevent="saveRoles">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('access.members.rolesIn', { company: props.member.company.name })">
      <div class="grid gap-3">
        <RoleCheckboxes v-model="roleIds" :roles="options" :legend="t('access.members.rolesIn', { company: props.member.company.name })" :empty-text="t('access.members.noRoles')" :disabled="busy" />
        <UAlert v-if="conflict" role="alert" color="warning" variant="subtle" :title="t('access.members.conflict')">
          <template #actions><UButton type="button" color="neutral" variant="outline" :label="t('access.members.reload')" :loading="reloading" :disabled="!hydrated || update.isPending.value || reloading" data-testid="member-roles-reload" @click="reloadDraft" /></template>
        </UAlert>
      </div>
    </SharedFormSection>
    <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="message" />
    <SharedFormActions>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" :disabled="update.isPending.value || reloading" @click="emit('cancel')" />
        <UButton type="submit" :form="formId" color="primary" :label="t('access.members.saveRoles')" :loading="update.isPending.value" :disabled="busy" data-testid="member-save-roles" />
      </div>
    </SharedFormActions>
  </form>
</template>
