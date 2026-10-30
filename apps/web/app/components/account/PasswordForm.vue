<script setup lang="ts">
import { PasswordChangeSchema } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { clearPasswordRefs, passwordErrorField, validatePasswordForm } from '@/composables/passwordForm'
import { useChangePassword } from '@/composables/useChangePassword'

const { t } = useI18n()
const hydrated = useHydrated()
const mutation = useChangePassword()
const toast = useToast()

const current = ref('')
const next = ref('')
const confirm = ref('')
const currentError = ref<string | null>(null)
const newError = ref<string | null>(null)
const formError = ref<string | null>(null)
const success = ref(false)
const fields = { current, next, confirm }

const disabled = computed(() => !hydrated.value || mutation.isPending.value)

function clearSecrets() {
  clearPasswordRefs(fields)
}

function clearMessages() {
  currentError.value = null
  newError.value = null
  formError.value = null
  success.value = false
}

async function submit() {
  clearMessages()
  const validation = validatePasswordForm(current.value, next.value, confirm.value)
  if (!current.value) currentError.value = t('account.currentRequired')
  if (validation.mismatch) formError.value = t('account.passwordMismatch')
  if (validation.weak) newError.value = t('account.passwordTooShort')
  if (!validation.valid) return

  try {
    const payload = PasswordChangeSchema.parse({ current: current.value, new: next.value })
    await mutation.mutateAsync(payload)
    await refreshNuxtData('me')
    success.value = true
    toast.add({ title: t('account.success'), color: 'success' })
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null
    const field = apiError ? passwordErrorField(apiError.code) : null
    if (field === 'current') currentError.value = apiError!.message
    else if (field === 'new') newError.value = apiError!.message
    else formError.value = apiError?.message ?? t('errors.generic')
  } finally {
    clearSecrets()
    mutation.reset()
  }
}

onBeforeUnmount(() => {
  clearSecrets()
  mutation.reset()
})
</script>

<template>
  <UForm :state="{ current, next, confirm }" class="liwan-form" method="post" @submit="submit">
    <UFormField :label="t('account.currentPassword')" name="pw-current" :error="currentError ?? undefined">
      <UInput
        id="pw-current" v-model="current" data-testid="pw-current" type="password"
        autocomplete="current-password" dir="ltr" class="w-full text-start"
        :disabled="disabled"
      />
      <template #error><span v-if="currentError" role="alert">{{ currentError }}</span></template>
    </UFormField>

    <UFormField :label="t('account.newPassword')" name="pw-new" :error="newError ?? undefined">
      <UInput
        id="pw-new" v-model="next" data-testid="pw-new" type="password"
        autocomplete="new-password" dir="ltr" class="w-full text-start"
        :disabled="disabled"
      />
      <template #error><span v-if="newError" role="alert">{{ newError }}</span></template>
    </UFormField>

    <UFormField :label="t('account.confirmPassword')" name="pw-confirm" :error="formError ?? undefined">
      <UInput
        id="pw-confirm" v-model="confirm" data-testid="pw-confirm" type="password"
        autocomplete="new-password" dir="ltr" class="w-full text-start"
        :disabled="disabled"
      />
      <template #error><span v-if="formError" role="alert">{{ formError }}</span></template>
    </UFormField>

    <UAlert v-if="success" role="status" color="success" variant="subtle" :title="t('account.success')" />
    <SharedFormActions>
      <UButton type="submit" data-testid="pw-submit" color="primary" class="w-full sm:w-auto" :label="t('account.submit')" :disabled="disabled" />
    </SharedFormActions>
  </UForm>
</template>
