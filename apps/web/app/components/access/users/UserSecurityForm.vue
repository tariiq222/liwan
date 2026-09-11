<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { useIsMutating } from '@tanstack/vue-query'
import type { AdminUserDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
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
function showError(error: unknown) {
  if (!(error instanceof ApiError)) return t('errors.generic')
  if (error.status === 409 || error.code === 'conflict') return t('access.errors.conflict')
  if (error.code === 'weak_password') return t('access.errors.weakPassword')
  const translated = `access.errors.${error.code}`
  return error.code && t(translated) !== translated ? t(translated) : (error.message || t('errors.generic'))
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
    errorKey.value = showError(error)
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
    errorKey.value = showError(error)
  }
}

onBeforeUnmount(clearSecrets)
</script>

<template>
  <UCard>
    <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('access.users.securityTitle') }}</h2></template>
    <div class="space-y-5">
      <p v-if="props.user.protected" class="text-sm text-muted">{{ t('access.protectedUser') }}</p>
      <template v-else>
        <div v-if="canReset || canReactivate" class="space-y-3">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('access.users.password')" name="admin-password">
              <UInput id="admin-password" v-model="password" type="password" autocomplete="new-password" dir="ltr" class="w-full" :disabled="!hydrated || anyPending" />
            </UFormField>
            <UFormField :label="t('access.users.passwordConfirmation')" name="admin-password-confirmation">
              <UInput id="admin-password-confirmation" v-model="passwordConfirmation" type="password" autocomplete="new-password" dir="ltr" class="w-full" :disabled="!hydrated || anyPending" />
            </UFormField>
          </div>
          <p v-if="passwordConfirmation && password !== passwordConfirmation" class="text-xs text-error">{{ t('access.users.passwordMismatch') }}</p>
          <UButton v-if="canReset" color="primary" :disabled="anyPending || !password.length || password !== passwordConfirmation" :label="pendingAction === 'reset' ? t('access.users.confirmAction') : t('access.users.resetPassword')" @click="resetPassword" />
          <UAlert v-if="pendingAction === 'reset'" role="alert" color="warning" variant="subtle" :title="t('access.users.confirmResetPassword', { name: props.user.name })" :actions="[{ label: t('app.cancel'), color: 'neutral', variant: 'ghost', onClick: () => { pendingAction = null } }]" />
        </div>
        <div v-if="canDisable || canReactivate" class="space-y-3">
          <div class="flex flex-wrap items-center gap-3">
            <UButton color="secondary" variant="outline" :disabled="anyPending || (canReactivate && (!password.length || password !== passwordConfirmation))" :label="pendingAction === (props.user.active ? 'disable' : 'reactivate') ? t('access.users.confirmAction') : (props.user.active ? t('access.users.disable') : t('access.users.reactivate'))" @click="changeState" />
            <span class="text-sm text-muted">{{ props.user.active ? t('access.users.disableHint') : t('access.users.reactivateHint') }}</span>
          </div>
          <UAlert v-if="pendingAction === 'disable'" role="alert" color="warning" variant="subtle" :title="t('access.users.confirmDisable', { name: props.user.name })" :actions="[{ label: t('app.cancel'), color: 'neutral', variant: 'ghost', onClick: () => { pendingAction = null } }]" />
          <UAlert v-if="pendingAction === 'reactivate'" role="alert" color="warning" variant="subtle" :title="t('access.users.confirmReactivate', { name: props.user.name })" :actions="[{ label: t('app.cancel'), color: 'neutral', variant: 'ghost', onClick: () => { pendingAction = null } }]" />
        </div>
        <p v-if="!canReset && !canDisable && !canReactivate" class="text-sm text-muted">{{ t('access.readOnly') }}</p>
      </template>
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="errorKey.startsWith('access.') || errorKey === 'errors.generic' ? t(errorKey) : errorKey" />
    </div>
  </UCard>
</template>
