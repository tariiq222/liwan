<script setup lang="ts">
import { MIN_PASSWORD_LENGTH } from '@liwan/contracts'
import { accountLinkFailure, useAccountPublic } from '@/composables/useAccountPublic'

// The emailed reset link: the account holder chooses a new password. The token alone authorizes it.
definePageMeta({ layout: false, access: 'public' })

const { t } = useI18n()
const route = useRoute()
const { checkToken, resetPassword } = useAccountPublic()
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const password = ref('')
const confirm = ref('')
const pending = ref(false)
const state = ref<'checking' | 'form' | 'invalid' | 'success'>(token.value ? 'checking' : 'invalid')
// A refused password or an unreachable service keeps the form; the latter keeps the typed password so the same button retries.
const formError = ref<'passwordRejected' | 'unavailable' | null>(null)
const login = ref<string | null>(null)
const hydrated = useHydrated()

const lengthOk = computed(() => password.value.trim().length >= MIN_PASSWORD_LENGTH)
const matchOk = computed(() => !!confirm.value && password.value === confirm.value)
const canSubmit = computed(() => lengthOk.value && matchOk.value && !pending.value && hydrated.value)
const loginHref = computed(() => (login.value ? { path: '/login', query: { login: login.value } } : '/login'))

// Learn before the password is typed whether the link is still usable; the answer is only yes or no.
// If the check itself fails, show the form anyway: resetting still validates the token.
onMounted(async () => {
  if (state.value !== 'checking') return
  try {
    state.value = (await checkToken(token.value, 'reset')) ? 'form' : 'invalid'
  } catch {
    state.value = 'form'
  }
})

async function submit() {
  if (!canSubmit.value) return
  pending.value = true
  formError.value = null
  let keepPassword = false
  try {
    login.value = await resetPassword({ token: token.value, password: password.value })
    state.value = 'success'
  } catch (error) {
    const failure = accountLinkFailure(error)
    if (failure === 'weak_password') formError.value = 'passwordRejected'
    else if (failure === 'unavailable') { formError.value = 'unavailable'; keepPassword = true }
    else state.value = 'invalid'
  } finally {
    if (!keepPassword) {
      password.value = ''
      confirm.value = ''
    }
    pending.value = false
  }
}
</script>

<template>
  <SharedStandalonePage :title="t('accountLink.reset.title')">
    <p v-if="state === 'checking'" role="status" class="text-center text-sm text-muted">{{ t('accountLink.checking') }}</p>
    <form v-else-if="state === 'form'" class="liwan-form" novalidate @submit.prevent="submit">
      <p class="-mt-2 text-center text-sm text-muted">{{ t('accountLink.reset.subtitle') }}</p>
      <UFormField :label="t('accountLink.passwordLabel')" name="password" required>
        <UInput id="password" v-model="password" type="password" autocomplete="new-password" dir="ltr" class="w-full" />
      </UFormField>
      <UFormField :label="t('accountLink.confirmLabel')" name="confirm" required>
        <UInput id="confirm" v-model="confirm" type="password" autocomplete="new-password" dir="ltr" class="w-full" />
      </UFormField>
      <div class="text-sm text-muted">
        <p class="font-medium">{{ t('accountLink.rulesTitle') }}</p>
        <ul class="mt-1 grid gap-1">
          <li :class="lengthOk ? 'text-success' : ''">{{ t('accountLink.ruleLength') }}</li>
          <li :class="matchOk ? 'text-success' : ''">{{ t('accountLink.ruleMatch') }}</li>
        </ul>
      </div>
      <UAlert v-if="formError" role="alert" :color="formError === 'unavailable' ? 'warning' : 'error'" variant="subtle" :icon="formError === 'unavailable' ? 'i-lucide-cloud-off' : 'i-lucide-circle-alert'" :title="t(`accountLink.${formError}Title`)" :description="t(`accountLink.${formError}Body`)" />
      <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!canSubmit" :loading="pending" :label="formError === 'unavailable' ? t('accountLink.retry') : t('accountLink.reset.submit')" />
    </form>
    <UAlert v-else-if="state === 'invalid'" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('accountLink.invalidTitle')" :description="t('accountLink.invalidBody')" />
    <div v-else class="grid gap-4">
      <UAlert role="status" color="success" variant="subtle" icon="i-lucide-circle-check" :title="t('accountLink.reset.successTitle')" :description="login ? t('accountLink.reset.successLogin', { login }) : t('accountLink.reset.successBody')" />
      <UButton :to="loginHref" size="lg" class="w-full justify-center" :label="t('accountLink.signIn')" />
    </div>
  </SharedStandalonePage>
</template>
