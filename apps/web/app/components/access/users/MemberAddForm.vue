<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useAddMembership } from '@/composables/useMemberships'
import { accessErrorMessage } from '@/utils/accessErrors'
import RoleCheckboxes, { type RoleOption } from '@/components/access/users/RoleCheckboxes.vue'

// Adds an existing account of the organisation to a branch by the email typed in full. `companyId` is the branch the root
// company adds to; the roles are that branch's.
const props = defineProps<{ companyId: number; roles: RoleOption[] }>()
const emit = defineEmits<{ added: [name: string]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const add = useAddMembership()
const login = ref('')
const roleIds = ref<number[]>([])
const error = ref('')
const loginInvalid = computed(() => login.value.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login.value.trim()))
const canSubmit = computed(() => hydrated.value && !add.isPending.value && login.value.trim() !== '' && !loginInvalid.value && roleIds.value.length > 0)
const dirty = computed(() => login.value !== '' || roleIds.value.length > 0)

async function submit() {
  if (!canSubmit.value) return
  error.value = ''
  try {
    const member = await add.mutateAsync({
      login: login.value.trim(),
      assignments: roleIds.value.map(role_id => ({ role_id, scope: { kind: 'company' as const, id: props.companyId } })),
      company_id: props.companyId,
    })
    login.value = ''
    roleIds.value = []
    emit('added', member.name)
  } catch (cause) {
    // Every email that cannot be added answers the same 404 (unknown, archived, support or not yet accepted): one message that claims nothing.
    error.value = cause instanceof ApiError && cause.code === 'not_found' ? t('access.members.emailNotFound') : accessErrorMessage(cause, t)
  }
}
</script>

<template>
  <UForm :state="{ login, roleIds }" class="liwan-form" method="post" data-testid="member-add-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UFormField :label="t('access.users.loginEmail')" name="member-login" :help="t('access.members.loginHint')" :error="loginInvalid ? t('access.users.loginInvalid') : undefined" required>
      <UInput v-model="login" type="email" autocomplete="off" dir="ltr" class="w-full" required :disabled="!hydrated || add.isPending.value" />
    </UFormField>
    <RoleCheckboxes v-model="roleIds" :roles="props.roles" :legend="t('access.users.role')" :empty-text="t('access.members.noRoles')" :disabled="!hydrated || add.isPending.value" />
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />
    <SharedFormActions>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" :disabled="add.isPending.value" @click="emit('cancel')" />
        <UButton type="submit" color="primary" :label="t('access.members.add')" :loading="add.isPending.value" :disabled="!canSubmit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
