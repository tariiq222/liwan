<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import type { AdminUserDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useDisableAdminUser, useReactivateAdminUser, useResetAdminUserPassword } from '@/composables/useAdminUsers'

const props = defineProps<{ user: AdminUserDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const password = ref('')
const passwordConfirmation = ref('')
const reset = useResetAdminUserPassword()
const disable = useDisableAdminUser()
const reactivate = useReactivateAdminUser()
const errorKey = ref('')
const successKey = ref('')
const pendingAction = ref<'reset' | 'disable' | 'reactivate' | null>(null)
const canReset = computed(() => hydrated.value && props.user.allowed_actions.includes('reset_password') && !props.user.protected)
const canDisable = computed(() => hydrated.value && props.user.active && props.user.allowed_actions.includes('disable') && !props.user.protected)
const canReactivate = computed(() => hydrated.value && !props.user.active && props.user.allowed_actions.includes('reactivate') && !props.user.protected)
const anyPending = computed(() => reset.isPending.value || disable.isPending.value || reactivate.isPending.value)
function clearSecrets() {
  password.value = ''
  passwordConfirmation.value = ''
}
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
  successKey.value = ''
  if (!canReset.value || !password.value.length || password.value !== passwordConfirmation.value || !beginOrConfirm('reset')) return
  try {
    await reset.mutateAsync({ id: props.user.id, body: { password: password.value, expected_version: props.user.version } })
    clearSecrets()
    successKey.value = 'access.users.passwordReset'
  } catch (error) {
    clearSecrets()
    errorKey.value = showError(error)
  }
}

async function changeState() {
  errorKey.value = ''
  successKey.value = ''
  const action = props.user.active ? 'disable' : 'reactivate'
  if ((!canDisable.value && !canReactivate.value) || (canReactivate.value && (!password.value.length || password.value !== passwordConfirmation.value)) || !beginOrConfirm(action)) return
  try {
    if (action === 'disable') await disable.mutateAsync({ id: props.user.id, body: { expected_version: props.user.version } })
    else await reactivate.mutateAsync({ id: props.user.id, body: { expected_version: props.user.version, password: password.value } })
    clearSecrets()
    successKey.value = action === 'disable' ? 'access.users.accessDisabled' : 'access.users.accessReactivated'
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
        <Label for="admin-password">{{ t('access.users.password') }}</Label>
        <Input id="admin-password" v-model="password" type="password" autocomplete="new-password" dir="ltr" :disabled="!hydrated || anyPending" />
        <Label for="admin-password-confirmation">{{ t('access.users.passwordConfirmation') }}</Label>
        <Input id="admin-password-confirmation" v-model="passwordConfirmation" type="password" autocomplete="new-password" dir="ltr" :disabled="!hydrated || anyPending" />
        <p v-if="passwordConfirmation && password !== passwordConfirmation" class="text-xs text-destructive">{{ t('access.users.passwordMismatch') }}</p>
        <Button v-if="canReset" :disabled="anyPending || !password.length || password !== passwordConfirmation" @click="resetPassword">{{ pendingAction === 'reset' ? t('access.users.confirmAction') : t('access.users.resetPassword') }}</Button>
        <div v-if="pendingAction === 'reset'" role="alert" class="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300"><span>{{ t('access.users.confirmResetPassword', { name: props.user.name }) }}</span><Button type="button" variant="ghost" size="sm" @click="pendingAction = null">{{ t('app.cancel') }}</Button></div>
      </div>
      <div v-if="canDisable || canReactivate" class="flex flex-wrap items-center gap-3">
        <Button variant="outline" :disabled="anyPending || (canReactivate && (!password.length || password !== passwordConfirmation))" @click="changeState">
          {{ pendingAction === (props.user.active ? 'disable' : 'reactivate') ? t('access.users.confirmAction') : (props.user.active ? t('access.users.disable') : t('access.users.reactivate')) }}
        </Button>
        <span class="text-sm text-muted-foreground">{{ props.user.active ? t('access.users.disableHint') : t('access.users.reactivateHint') }}</span>
        <div v-if="pendingAction === 'disable'" role="alert" class="basis-full flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300"><span>{{ t('access.users.confirmDisable', { name: props.user.name }) }}</span><Button type="button" variant="ghost" size="sm" @click="pendingAction = null">{{ t('app.cancel') }}</Button></div>
        <div v-if="pendingAction === 'reactivate'" role="alert" class="basis-full flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300"><span>{{ t('access.users.confirmReactivate', { name: props.user.name }) }}</span><Button type="button" variant="ghost" size="sm" @click="pendingAction = null">{{ t('app.cancel') }}</Button></div>
      </div>
      <p v-if="!canReset && !canDisable && !canReactivate" class="text-sm text-muted-foreground">{{ t('access.readOnly') }}</p>
    </template>
    <p v-if="successKey" role="status" class="text-sm text-emerald-700 dark:text-emerald-300">{{ t(successKey) }}</p>
    <p v-if="errorKey" role="alert" class="text-sm text-destructive">{{ errorKey.startsWith('access.') || errorKey === 'errors.generic' ? t(errorKey) : errorKey }}</p>
  </section>
</template>
