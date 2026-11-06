<script setup lang="ts">
import { useIsMutating } from '@tanstack/vue-query'
import type { AdminUserDetail } from '@liwan/contracts'
import { accessErrorMessage } from '@/utils/accessErrors'
import { adminUserMutationKey, useDisableAdminUser, useReactivateAdminUser, useSendAdminUserResetLink } from '@/composables/useAdminUsers'

const props = defineProps<{ user: AdminUserDetail; onSuccessKey: (userId: number, key: string) => void }>()
const { t } = useI18n()
const hydrated = useHydrated()
const resetLink = useSendAdminUserResetLink()
const disable = useDisableAdminUser()
const reactivate = useReactivateAdminUser()
const errorKey = ref('')
const pendingAction = ref<'reset' | 'disable' | 'reactivate' | null>(null)
const canReset = computed(() => hydrated.value && props.user.allowed_actions.includes('send_reset_link') && !props.user.protected)
const canDisable = computed(() => hydrated.value && props.user.active && props.user.allowed_actions.includes('disable') && !props.user.protected)
const canReactivate = computed(() => hydrated.value && !props.user.active && props.user.allowed_actions.includes('reactivate') && !props.user.protected)
const mutating = useIsMutating({ mutationKey: adminUserMutationKey })
const anyPending = computed(() => mutating.value > 0 || resetLink.isPending.value || disable.isPending.value || reactivate.isPending.value)
function setSuccess(key: string, userId = props.user.id) {
  props.onSuccessKey(userId, key)
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
async function sendResetLink() {
  errorKey.value = ''
  const targetId = props.user.id
  setSuccess('', targetId)
  if (!canReset.value || !beginOrConfirm('reset')) return
  try {
    await resetLink.mutateAsync({ id: targetId, body: { expected_version: props.user.version } })
    setSuccess('access.users.resetLinkSent', targetId)
  } catch (error) {
    errorKey.value = accessErrorMessage(error, t)
  }
}

async function changeState() {
  errorKey.value = ''
  const targetId = props.user.id
  setSuccess('', targetId)
  const action = props.user.active ? 'disable' : 'reactivate'
  if ((!canDisable.value && !canReactivate.value) || !beginOrConfirm(action)) return
  try {
    const mutation = action === 'disable' ? disable : reactivate
    await mutation.mutateAsync({ id: targetId, body: { expected_version: props.user.version } })
    setSuccess(action === 'disable' ? 'access.users.accessDisabled' : 'access.users.accessReactivated', targetId)
  } catch (error) {
    errorKey.value = accessErrorMessage(error, t)
  }
}
</script>

<template>
  <SharedFormSection panel :title="t('access.users.securityTitle')">
    <div class="grid gap-5">
      <UAlert v-if="props.user.protected" color="neutral" variant="subtle" icon="i-lucide-lock" :title="t('access.protectedUser')" />
      <template v-else>
        <div v-if="canReset" class="grid gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <UButton color="primary" icon="i-lucide-mail" :disabled="anyPending || pendingAction !== null" :label="t('access.users.sendResetLink')" @click="sendResetLink" />
            <span class="text-sm text-muted">{{ t('access.users.sendResetLinkHint') }}</span>
          </div>
          <SharedInlineConfirm v-if="pendingAction === 'reset'" color="warning" :title="t('access.users.confirmSendResetLink', { name: props.user.name })" :confirm-label="t('access.users.confirmAction')" :pending="anyPending" @confirm="sendResetLink" @cancel="pendingAction = null" />
        </div>
        <div v-if="canDisable || canReactivate" class="grid gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <UButton color="neutral" variant="outline" :disabled="anyPending || pendingAction !== null" :label="props.user.active ? t('access.users.disable') : t('access.users.reactivate')" @click="changeState" />
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
