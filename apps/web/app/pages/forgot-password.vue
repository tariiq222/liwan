<script setup lang="ts">
import { ForgotPasswordInputSchema } from '@liwan/contracts'
import { accountLinkFailure, useAccountPublic } from '@/composables/useAccountPublic'

// «نسيت كلمة المرور؟»: the same confirmation whether or not the email has an account, so the page reveals nothing.
definePageMeta({ layout: false, access: 'public' })

const { t } = useI18n()
const { requestPasswordReset } = useAccountPublic()
const email = ref('')
const pending = ref(false)
const sent = ref(false)
const unavailable = ref(false)
const hydrated = useHydrated()

const emailOk = computed(() => ForgotPasswordInputSchema.safeParse({ email: email.value }).success)
const emailError = computed(() => (email.value.trim() && !emailOk.value ? t('accountLink.forgot.emailInvalid') : undefined))
const canSubmit = computed(() => emailOk.value && !pending.value && hydrated.value)

async function submit() {
  if (!canSubmit.value) return
  pending.value = true
  unavailable.value = false
  try {
    await requestPasswordReset({ email: email.value })
    sent.value = true
  } catch (error) {
    // The server answers 202 for every email, so a failure here is the service being busy or unreachable: keep the email and retry.
    if (accountLinkFailure(error) === 'unavailable') unavailable.value = true
    else sent.value = true
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <SharedStandalonePage :title="t('accountLink.forgot.title')">
    <div v-if="sent" class="grid gap-4">
      <UAlert role="status" color="success" variant="subtle" icon="i-lucide-mail-check" :title="t('accountLink.forgot.sentTitle')" :description="t('accountLink.forgot.sentBody')" />
      <UButton to="/login" color="neutral" variant="outline" size="lg" class="w-full justify-center" :label="t('accountLink.backToSignIn')" />
    </div>
    <form v-else class="liwan-form" novalidate @submit.prevent="submit">
      <p class="-mt-2 text-center text-sm text-muted">{{ t('accountLink.forgot.subtitle') }}</p>
      <UFormField :label="t('accountLink.forgot.email')" name="email" :error="emailError" required>
        <UInput id="email" v-model="email" type="email" inputmode="email" autocomplete="email" dir="ltr" class="w-full text-start" :disabled="!hydrated" />
      </UFormField>
      <UAlert v-if="unavailable" role="alert" color="warning" variant="subtle" icon="i-lucide-cloud-off" :title="t('accountLink.unavailableTitle')" :description="t('accountLink.unavailableBody')" />
      <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!canSubmit" :loading="pending" :label="unavailable ? t('accountLink.retry') : t('accountLink.forgot.submit')" />
      <UButton to="/login" color="neutral" variant="link" class="justify-center" :label="t('accountLink.backToSignIn')" />
    </form>
  </SharedStandalonePage>
</template>
