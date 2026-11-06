<script setup lang="ts">
import { MIN_ACCOUNT_PASSWORD_LENGTH, MobileSchema } from '@liwan/contracts'
import { accountLinkFailure, useAccountPublic } from '@/composables/useAccountPublic'
import { normalizeMobileInput } from '@/composables/useMe'

// The emailed invitation link: the invitee sets their own mobile number and password. The token alone authorizes it.
definePageMeta({ layout: false, access: 'public' })

const { t } = useI18n()
const route = useRoute()
const { checkToken, acceptInvitation } = useAccountPublic()
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const mobile = ref('')
const password = ref('')
const confirm = ref('')
const pending = ref(false)
const state = ref<'checking' | 'form' | 'invalid' | 'success'>(token.value ? 'checking' : 'invalid')
// A refused password or an unreachable service keeps the form; the latter keeps the typed values so the same button retries.
const formError = ref<'passwordRejected' | 'unavailable' | null>(null)
const mobileRefusal = ref<'mobileInvalid' | 'mobileTaken' | null>(null)
const login = ref<string | null>(null)
const hydrated = useHydrated()

const mobileValue = computed(() => normalizeMobileInput(mobile.value))
const mobileOk = computed(() => MobileSchema.safeParse(mobileValue.value).success)
const mobileError = computed(() => mobileRefusal.value ?? (mobile.value.trim() && !mobileOk.value ? 'mobileInvalid' : null))
const lengthOk = computed(() => password.value.trim().length >= MIN_ACCOUNT_PASSWORD_LENGTH)
const matchOk = computed(() => !!confirm.value && password.value === confirm.value)
const canSubmit = computed(() => mobileOk.value && lengthOk.value && matchOk.value && !pending.value && hydrated.value)
const loginHref = computed(() => (login.value ? { path: '/login', query: { login: login.value } } : '/login'))

// Learn before anything is typed whether the link is still usable; the answer is only yes or no.
// If the check itself fails, show the form anyway: accepting still validates the token.
onMounted(async () => {
  if (state.value !== 'checking') return
  try {
    state.value = (await checkToken(token.value, 'invite')) ? 'form' : 'invalid'
  } catch {
    state.value = 'form'
  }
})

async function submit() {
  if (!canSubmit.value) return
  pending.value = true
  formError.value = null
  mobileRefusal.value = null
  let keepValues = false
  try {
    login.value = await acceptInvitation({ token: token.value, mobile: mobileValue.value, password: password.value })
    state.value = 'success'
  } catch (error) {
    const failure = accountLinkFailure(error)
    if (failure === 'weak_password') formError.value = 'passwordRejected'
    else if (failure === 'invalid_mobile') { mobileRefusal.value = 'mobileInvalid'; keepValues = true }
    else if (failure === 'mobile_taken') { mobileRefusal.value = 'mobileTaken'; keepValues = true }
    else if (failure === 'unavailable') { formError.value = 'unavailable'; keepValues = true }
    else state.value = 'invalid'
  } finally {
    if (!keepValues) {
      password.value = ''
      confirm.value = ''
    }
    pending.value = false
  }
}
</script>

<template>
  <SharedStandalonePage :title="t('accountLink.join.title')">
    <p v-if="state === 'checking'" role="status" class="text-center text-sm text-muted">{{ t('accountLink.checking') }}</p>
    <form v-else-if="state === 'form'" class="liwan-form" novalidate @submit.prevent="submit">
      <p class="-mt-2 text-center text-sm text-muted">{{ t('accountLink.join.subtitle') }}</p>
      <UFormField :label="t('accountLink.mobileLabel')" name="mobile" :help="t('accountLink.mobileHint')" :error="mobileError ? t(`accountLink.${mobileError}`) : undefined" required>
        <UInput id="mobile" v-model="mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="+966 5X XXX XXXX" dir="ltr" class="w-full text-start" />
      </UFormField>
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
      <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!canSubmit" :loading="pending" :label="formError === 'unavailable' ? t('accountLink.retry') : t('accountLink.join.submit')" />
    </form>
    <UAlert v-else-if="state === 'invalid'" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('accountLink.invalidTitle')" :description="t('accountLink.invalidBody')" />
    <div v-else class="grid gap-4">
      <UAlert role="status" color="success" variant="subtle" icon="i-lucide-circle-check" :title="t('accountLink.join.successTitle')" :description="login ? t('accountLink.join.successLogin', { login }) : t('accountLink.join.successBody')" />
      <UButton :to="loginHref" size="lg" class="w-full justify-center" :label="t('accountLink.signIn')" />
    </div>
  </SharedStandalonePage>
</template>
