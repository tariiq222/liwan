<script setup lang="ts">
import { useAddMembership } from '@/composables/useMemberships'
import { membershipErrorMessage } from '@/utils/accessErrors'
import RoleCheckboxes, { type RoleOption } from '@/components/access/users/RoleCheckboxes.vue'

// Adds an existing account of the organisation to a branch by the email typed in full. `companyId` is the branch the root
// company adds to; the roles are that branch's. The form sits in the create panel of the members route, so its actions
// live in the panel footer through the form id, and the field errors appear after the first save attempt (DESIGN.md §6).
const props = defineProps<{ companyId: number; roles: RoleOption[] }>()
const emit = defineEmits<{ added: [name: string]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const add = useAddMembership()
const formId = useId()
const login = ref('')
const roleIds = ref<number[]>([])
const attempted = ref(false)
const error = ref('')
const saved = ref(false)
const loginInvalid = computed(() => login.value.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login.value.trim()))
const loginError = computed(() => {
  if (!attempted.value) return undefined
  if (login.value.trim() === '') return t('access.members.loginRequired')
  if (loginInvalid.value) return t('access.users.loginInvalid')
  return undefined
})
const rolesMissing = computed(() => attempted.value && roleIds.value.length === 0)
const dirty = computed(() => !saved.value && (login.value !== '' || roleIds.value.length > 0))

async function submit() {
  attempted.value = true
  if (login.value.trim() === '' || loginInvalid.value || roleIds.value.length === 0 || !hydrated.value || add.isPending.value) return
  error.value = ''
  try {
    const member = await add.mutateAsync({
      login: login.value.trim(),
      assignments: roleIds.value.map(role_id => ({ role_id, scope: { kind: 'company' as const, id: props.companyId } })),
      company_id: props.companyId,
    })
    saved.value = true
    login.value = ''
    roleIds.value = []
    emit('added', member.name)
  } catch (cause) {
    error.value = membershipErrorMessage(cause, t)
  }
}
</script>

<template>
  <form :id="formId" class="liwan-form" novalidate data-testid="member-add-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UFormField :label="t('access.users.loginEmail')" name="member-login" :help="t('access.members.loginHint')" :error="loginError" required>
      <UInput v-model="login" type="email" autocomplete="off" dir="ltr" class="w-full" required :disabled="!hydrated || add.isPending.value" />
    </UFormField>
    <RoleCheckboxes v-model="roleIds" :roles="props.roles" :legend="t('access.users.role')" :empty-text="t('access.members.noRoles')" :disabled="!hydrated || add.isPending.value" />
    <p v-if="rolesMissing" class="text-sm text-error">{{ t('access.members.roleRequired') }}</p>
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />
    <SharedFormActions>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" :disabled="add.isPending.value" @click="emit('cancel')" />
        <UButton type="submit" :form="formId" color="primary" :label="t('access.members.add')" :loading="add.isPending.value" :disabled="!hydrated || add.isPending.value" />
      </div>
    </SharedFormActions>
  </form>
</template>
