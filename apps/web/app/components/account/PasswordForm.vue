<script setup lang="ts">
import { PasswordChangeSchema } from '@nasq/contracts'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { clearPasswordRefs, passwordErrorField, validatePasswordForm } from '@/composables/passwordForm'
import { useChangePassword } from '@/composables/useChangePassword'

const { t } = useI18n()
const hydrated = useHydrated()
const mutation = useChangePassword()

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
  if (validation.mismatch) formError.value = t('account.passwordMismatch')
  if (validation.weak) newError.value = t('account.passwordTooShort')
  if (!validation.valid) return

  try {
    const payload = PasswordChangeSchema.parse({ current: current.value, new: next.value })
    await mutation.mutateAsync(payload)
    await refreshNuxtData('me')
    success.value = true
    toast.success(t('account.success'))
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
  <form class="grid max-w-lg gap-5" @submit.prevent="submit">
    <div class="grid gap-2">
      <Label for="pw-current">{{ t('account.currentPassword') }}</Label>
      <Input
        id="pw-current" v-model="current" data-testid="pw-current" type="password"
        autocomplete="current-password" dir="ltr" class="text-start"
        :disabled="disabled" :aria-invalid="!!currentError"
      />
      <p v-if="currentError" class="text-sm text-destructive">{{ currentError }}</p>
    </div>

    <div class="grid gap-2">
      <Label for="pw-new">{{ t('account.newPassword') }}</Label>
      <Input
        id="pw-new" v-model="next" data-testid="pw-new" type="password"
        autocomplete="new-password" dir="ltr" class="text-start"
        :disabled="disabled" :aria-invalid="!!newError"
      />
      <p v-if="newError" class="text-sm text-destructive">{{ newError }}</p>
    </div>

    <div class="grid gap-2">
      <Label for="pw-confirm">{{ t('account.confirmPassword') }}</Label>
      <Input
        id="pw-confirm" v-model="confirm" data-testid="pw-confirm" type="password"
        autocomplete="new-password" dir="ltr" class="text-start"
        :disabled="disabled" :aria-invalid="!!formError"
      />
    </div>

    <p v-if="formError" role="alert" class="text-sm text-destructive">{{ formError }}</p>
    <p v-if="success" role="status" class="text-sm text-emerald-600">{{ t('account.success') }}</p>
    <Button type="submit" data-testid="pw-submit" class="w-full sm:w-auto" :disabled="disabled">
      {{ t('account.submit') }}
    </Button>
  </form>
</template>
