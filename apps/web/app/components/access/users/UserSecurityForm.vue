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
  <section class="nasq-panel nasq-panel-body space-y-5">
    <h2 class="text-lg font-semibold">{{ t('access.users.securityTitle') }}</h2>
    <p v-if="props.user.protected" class="text-sm text-muted-foreground">{{ t('access.protectedUser') }}</p>
    <template v-else>
      <div v-if="canReset || canReactivate" class="space-y-2">
        <div class="nasq-form-grid">
          <div class="space-y-2">
            <Label for="admin-password">{{ t('access.users.password') }}</Label>
            <Input id="admin-password" v-model="password" type="password" autocomplete="new-password" dir="ltr" :disabled="!hydrated || anyPending" />
          </div>
          <div class="space-y-2">
            <Label for="admin-password-confirmation">{{ t('access.users.passwordConfirmation') }}</Label>
            <Input id="admin-password-confirmation" v-model="passwordConfirmation" type="password" autocomplete="new-password" dir="ltr" :disabled="!hydrated || anyPending" />
          </div>
        </div>
        <p v-if="passwordConfirmation && password !== passwordConfirmation" class="text-xs text-destructive">{{ t('access.users.passwordMismatch') }}</p>
        <Button v-if="canReset" :disabled="anyPending || !password.length || password !== passwordConfirmation" @click="resetPassword">{{ pendingAction === 'reset' ? t('access.users.confirmAction') : t('access.users.resetPassword') }}</Button>
        <div v-if="pendingAction === 'reset'" role="alert" class="nasq-status-callout-warning flex items-center gap-2 p-3 text-xs"><span>{{ t('access.users.confirmResetPassword', { name: props.user.name }) }}</span><Button type="button" variant="ghost" size="sm" @click="pendingAction = null">{{ t('app.cancel') }}</Button></div>
      </div>
      <div v-if="canDisable || canReactivate" class="nasq-form-footer">
        <Button variant="outline" :disabled="anyPending || (canReactivate && (!password.length || password !== passwordConfirmation))" @click="changeState">
          {{ pendingAction === (props.user.active ? 'disable' : 'reactivate') ? t('access.users.confirmAction') : (props.user.active ? t('access.users.disable') : t('access.users.reactivate')) }}
        </Button>
        <span class="text-sm text-muted-foreground">{{ props.user.active ? t('access.users.disableHint') : t('access.users.reactivateHint') }}</span>
        <div v-if="pendingAction === 'disable'" role="alert" class="nasq-status-callout-warning basis-full flex items-center gap-2 p-3 text-xs"><span>{{ t('access.users.confirmDisable', { name: props.user.name }) }}</span><Button type="button" variant="ghost" size="sm" @click="pendingAction = null">{{ t('app.cancel') }}</Button></div>
        <div v-if="pendingAction === 'reactivate'" role="alert" class="nasq-status-callout-warning basis-full flex items-center gap-2 p-3 text-xs"><span>{{ t('access.users.confirmReactivate', { name: props.user.name }) }}</span><Button type="button" variant="ghost" size="sm" @click="pendingAction = null">{{ t('app.cancel') }}</Button></div>
      </div>
      <p v-if="!canReset && !canDisable && !canReactivate" class="text-sm text-muted-foreground">{{ t('access.readOnly') }}</p>
    </template>
    <p v-if="errorKey" role="alert" class="text-sm text-destructive">{{ errorKey.startsWith('access.') || errorKey === 'errors.generic' ? t(errorKey) : errorKey }}</p>
  </section>
</template>
