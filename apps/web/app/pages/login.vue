<script setup lang="ts">
import { postLoginPath } from '~/utils/accessPolicy'
definePageMeta({ layout: false })

const { t } = useI18n()
const { branding } = useBranding()
const productName = computed(() => branding.value?.name ?? t('app.productName'))
const route = useRoute()
const { me, refresh } = useMe()
const login = ref('')
const password = ref('')
const totpCode = ref('')
const pending = ref(false)
const errorMessage = ref<string | null>(null)
const mfaPending = ref(false)
// Guards the submit button until the client has hydrated: submitting before
// hydration falls through to a native, unhandled form POST. See
// useHydrated() for why. The inputs stay enabled so a password manager can
// fill the server-rendered form on first paint — but v-model resets those
// nodes when hydration reaches them, so read whatever is already in the DOM
// before that happens and adopt it.
const hydrated = useHydrated()
const prefilled: Record<string, string> = {}
onBeforeMount(() => {
  for (const id of ['login', 'password']) {
    prefilled[id] = (document.getElementById(id) as HTMLInputElement | null)?.value ?? ''
  }
})
onMounted(() => {
  if (!login.value && prefilled.login) login.value = prefilled.login
  if (!password.value && prefilled.password) password.value = prefilled.password
})

// The Nitro auth endpoints answer with a machine code only (no prose), so the
// wording is chosen here, in the active locale. Anything unmapped falls back
// to the generic "sign-in failed" string.
const AUTH_ERROR_KEYS: Record<string, string> = {
  invalid_credentials: 'auth.invalidCredentials',
  missing_credentials: 'auth.loginFailed',
}

async function submit() {
  pending.value = true
  errorMessage.value = null
  try {
    const res = await $fetch('/api/auth/login', { method: 'POST', body: { login: login.value, password: password.value } })
    if (res.ok === false && res.mfa === 'totp') {
      mfaPending.value = true
      return
    }
    await refresh()
    await navigateTo(postLoginPath(me.value, route.query.next))
  } catch (e: any) {
    const code = e?.data?.data?.code as string | undefined
    errorMessage.value = t((code && AUTH_ERROR_KEYS[code]) || 'auth.loginFailed')
  } finally {
    pending.value = false
  }
}

async function submitTotp() {
  pending.value = true
  errorMessage.value = null
  try {
    await $fetch('/api/auth/totp', { method: 'POST', body: { code: totpCode.value } })
    await refresh()
    await navigateTo(postLoginPath(me.value, route.query.next))
  } catch {
    errorMessage.value = t('auth.totpInvalid')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <SharedStandalonePage>
    <template #header>
      <div class="flex flex-col items-center text-center">
        <img v-if="branding?.logo_url" :src="branding.logo_url" :alt="branding.name" class="mb-4 h-14 w-auto max-w-full object-contain" />
        <SharedBrandWordmark v-else size="lg" class="mb-3" />
        <h1 class="text-2xl font-semibold text-highlighted">{{ productName }}</h1>
        <p class="text-sm text-muted">{{ $t('auth.signInToContinue') }}</p>
      </div>
    </template>
    <form v-if="!mfaPending" class="grid gap-5" @submit.prevent="submit">
      <UFormField :label="$t('auth.username')" name="login" required>
        <UInput id="login" v-model="login" autocomplete="username" required dir="ltr" class="w-full text-start" />
      </UFormField>
      <UFormField :label="$t('auth.password')" name="password" required>
        <UInput id="password" v-model="password" type="password" autocomplete="current-password" required dir="ltr" class="w-full" />
      </UFormField>
      <UAlert v-if="errorMessage" role="alert" color="error" variant="subtle" :title="errorMessage" />
      <UButton type="submit" class="w-full justify-center" :disabled="pending || !hydrated" :label="$t('auth.signIn')" />
    </form>
    <form v-else class="grid gap-5" @submit.prevent="submitTotp">
      <UFormField :label="$t('auth.totpTitle')" name="totp" required>
        <UInput
          id="totp-code" v-model="totpCode" inputmode="numeric" autocomplete="one-time-code"
          required dir="ltr" class="w-full text-start"
        />
        <template #hint><span>{{ $t('auth.totpHint') }}</span></template>
      </UFormField>
      <UAlert v-if="errorMessage" role="alert" color="error" variant="subtle" :title="errorMessage" />
      <UButton type="submit" class="w-full justify-center" :disabled="pending" :label="$t('auth.continue')" />
    </form>
  </SharedStandalonePage>
</template>
