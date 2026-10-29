<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { useIsMutating } from '@tanstack/vue-query'
import type { AdminUserDetail } from '@webvue/contracts'
import { accessErrorMessage } from '@/utils/accessErrors'
import { adminUserMutationKey, useDisableAdminUser, useReactivateAdminUser, useResetAdminUserPassword } from '@/composables/useAdminUsers'

const props = defineProps<{ user: AdminUserDetail; onSuccessKey: (userId: number, key: string) => void }>()
const { t } = useI18n()
const hydrated = useHydrated()
const password = ref('')
const passwordConfirmation = ref('')
const reset = useResetAdminUserPassword()
const disable = useDisableAdminUser()
const reactivate = useReactivateAdminUser()
const errorKey = ref('')
const pendingAction = ref<'reset' | 'disable' | 'reactivate' | null>(null)
const canReset = computed(() => hydrated.value && props.user.allowed_actions.includes('reset_password') && !props.user.protected)
const canDisable = computed(() => hydrated.value && props.user.active && props.user.allowed_actions.includes('disable') && !props.user.protected)
const canReactivate = computed(() => hydrated.value && !props.user.active && props.user.allowed_actions.includes('reactivate') && !props.user.protected)
const mutating = useIsMutating({ mutationKey: adminUserMutationKey })
const anyPending = computed(() => mutating.value > 0 || reset.isPending.value || disable.isPending.value || reactivate.isPending.value)
function clearSecrets() {
  password.value = ''
  passwordConfirmation.value = ''
}
function setSuccess(key: string, userId = props.user.id) {
  props.onSuccessKey(userId, key)
}
watch(() => props.user.id, () => {
  clearSecrets()
})
function beginOrConfirm(action: 'reset' | 'disable' | 'reactivate') {
  if (anyPending.value || !hydrated.value) return false
  if (pendingAction.value !== action) {
    pendingAction.value = action
    return false
  }
  pendingAction.value = null
  return true
}
async function resetPassword() {
  errorKey.value = ''
  const targetId = props.user.id
  setSuccess('', targetId)
  if (!canReset.value || !password.value.length || password.value !== passwordConfirmation.value || !beginOrConfirm('reset')) return
  try {
    await reset.mutateAsync({ id: targetId, body: { password: password.value, expected_version: props.user.version } })
    clearSecrets()
    setSuccess('access.users.passwordReset', targetId)
  } catch (error) {
    clearSecrets()
    errorKey.value = accessErrorMessage(error, t)
  }
}

async function changeState() {
  errorKey.value = ''
  const targetId = props.user.id
  setSuccess('', targetId)
  const action = props.user.active ? 'disable' : 'reactivate'
  if ((!canDisable.value && !canReactivate.value) || (canReactivate.value && (!password.value.length || password.value !== passwordConfirmation.value)) || !beginOrConfirm(action)) return
  try {
    if (action === 'disable') await disable.mutateAsync({ id: targetId, body: { expected_version: props.user.version } })
    else await reactivate.mutateAsync({ id: targetId, body: { expected_version: props.user.version, password: password.value } })
    clearSecrets()
    setSuccess(action === 'disable' ? 'access.users.accessDisabled' : 'access.users.accessReactivated', targetId)
  } catch (error) {
    clearSecrets()
    errorKey.value = accessErrorMessage(error, t)
  }
}

onBeforeUnmount(clearSecrets)
</script>

<template>
  <SharedFormSection panel :title="t('access.users.securityTitle')">
    <div class="grid gap-5">
      <UAlert v-if="props.user.protected" color="neutral" variant="subtle" icon="i-lucide-lock" :title="t('access.protectedUser')" />
      <template v-else>
        <div v-if="canReset || canReactivate" class="grid gap-3">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('access.users.password')" name="admin-password">
              <UInput id="admin-password" v-model="password" type="password" autocomplete="new-password" dir="ltr" class="w-full" :disabled="!hydrated || anyPending" />
            </UFormField>
            <UFormField :label="t('access.users.passwordConfirmation')" name="admin-password-confirmation" :error="passwordConfirmation && password !== passwordConfirmation ? t('access.users.passwordMismatch') : undefined">
              <UInput id="admin-password-confirmation" v-model="passwordConfirmation" type="password" autocomplete="new-password" dir="ltr" class="w-full" :disabled="!hydrated || anyPending" />
            </UFormField>
          </div>
          <UButton v-if="canReset" color="primary" :disabled="anyPending || pendingAction !== null || !password.length || password !== passwordConfirmation" :label="t('access.users.resetPassword')" @click="resetPassword" />
          <SharedInlineConfirm v-if="pendingAction === 'reset'" color="warning" :title="t('access.users.confirmResetPassword', { name: props.user.name })" :confirm-label="t('access.users.confirmAction')" :pending="anyPending" @confirm="resetPassword" @cancel="pendingAction = null" />
        </div>
        <div v-if="canDisable || canReactivate" class="grid gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <UButton color="neutral" variant="outline" :disabled="anyPending || pendingAction !== null || (canReactivate && (!password.length || password !== passwordConfirmation))" :label="props.user.active ? t('access.users.disable') : t('access.users.reactivate')" @click="changeState" />
            <span class="text-sm text-muted">{{ props.user.active ? t('access.users.disableHint') : t('access.users.reactivateHint') }}</span>
          </div>
          <SharedInlineConfirm v-if="pendingAction === 'disable'" color="warning" :title="t('access.users.confirmDisable', { name: props.user.name })" :confirm-label="t('access.users.confirmAction')" :pending="anyPending" @confirm="changeState" @cancel="pendingAction = null" />
          <SharedInlineConfirm v-if="pendingAction === 'reactivate'" color="primary" :title="t('access.users.confirmReactivate', { name: props.user.name })" :confirm-label="t('access.users.confirmAction')" :pending="anyPending" @confirm="changeState" @cancel="pendingAction = null" />
        </div>
        <UAlert v-if="!canReset && !canDisable && !canReactivate" color="neutral" variant="subtle" icon="i-lucide-eye" :title="t('access.readOnly')" />
      </template>
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="errorKey.startsWith('access.') || errorKey === 'errors.generic' ? t(errorKey) : errorKey" />
    </div>
  </SharedFormSection>
</template>
