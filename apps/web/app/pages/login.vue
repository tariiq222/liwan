<script setup lang="ts">
import type { FormError } from '@nuxt/ui'
import { postLoginPath } from '~/utils/accessPolicy'
definePageMeta({ layout: false, access: 'guest' })

const { t } = useI18n()
const { branding } = useBranding()
const productName = computed(() => branding.value?.name ?? t('app.productName'))
const route = useRoute()
const { me, refresh } = useMe()
// ?login= only prefills the username (the invitation page links here); it is never trusted beyond that.
const queryLogin = typeof route.query.login === 'string' ? route.query.login.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 128) : ''
const state = reactive({ login: queryLogin, password: '' })
const totpState = reactive({ code: '' })
const pending = ref(false)
const errorMessage = ref<string | null>(route.query.reason === 'tenant_suspended' ? t('auth.tenantSuspended') : null)
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
  if (!state.login && prefilled.login) state.login = prefilled.login
  if (!state.password && prefilled.password) state.password = prefilled.password
})

// Native browser validation is off (novalidate on both forms); these messages are Arabic/English from the
// active locale and show under the field. The submit button stays enabled so an empty submit explains itself.
function validate(value: Partial<typeof state>): FormError[] {
  const errors: FormError[] = []
  if (!value.login?.trim()) errors.push({ name: 'login', message: t('auth.usernameRequired') })
  if (!value.password) errors.push({ name: 'password', message: t('auth.passwordRequired') })
  return errors
}
function validateTotp(value: Partial<typeof totpState>): FormError[] {
  return value.code?.trim() ? [] : [{ name: 'totp', message: t('auth.totpRequired') }]
}

// The Nitro auth endpoints answer with a machine code only (no prose), so the
// wording is chosen here, in the active locale. Anything unmapped falls back
// to the generic "sign-in failed" string.
const AUTH_ERROR_KEYS: Record<string, string> = {
  invalid_credentials: 'auth.invalidCredentials',
  missing_credentials: 'auth.loginFailed',
  tenant_suspended: 'auth.tenantSuspended',
}

async function submit() {
  pending.value = true
  errorMessage.value = null
  try {
    const res = await $fetch('/api/auth/login', { method: 'POST', body: { login: state.login, password: state.password } })
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
    await $fetch('/api/auth/totp', { method: 'POST', body: { code: totpState.code } })
    await refresh()
    await navigateTo(postLoginPath(me.value, route.query.next))
  } catch (e: any) {
    errorMessage.value = t(e?.data?.data?.code === 'tenant_suspended' ? 'auth.tenantSuspended' : 'auth.totpInvalid')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <SharedStandalonePage surface="brand">
    <template #brand>
      <SharedBrandWordmark size="xl" inverted data-testid="login-brand" />
    </template>
    <template #header>
      <div class="flex flex-col items-center text-center">
        <img v-if="branding?.logo_url" :src="branding.logo_url" :alt="branding.name" class="mb-4 h-14 w-auto max-w-full object-contain" />
        <h1 class="text-2xl font-semibold text-highlighted" :class="{ 'sr-only': !branding?.name }">{{ productName }}</h1>
        <p class="text-sm text-muted">{{ $t('auth.signInToContinue') }}</p>
      </div>
    </template>
    <UForm v-if="!mfaPending" novalidate :state="state" :validate="validate" class="grid gap-5" @submit="submit">
      <UFormField :label="$t('auth.username')" name="login" required>
        <UInput id="login" v-model="state.login" autocomplete="username" dir="ltr" class="w-full text-start" />
      </UFormField>
      <UFormField :label="$t('auth.password')" name="password" required>
        <UInput id="password" v-model="state.password" type="password" autocomplete="current-password" dir="ltr" class="w-full" />
      </UFormField>
      <UAlert v-if="errorMessage" role="alert" color="error" variant="subtle" :title="errorMessage" />
      <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!hydrated" :loading="pending" :label="$t('auth.signIn')" />
    </UForm>
    <UForm v-else novalidate :state="totpState" :validate="validateTotp" class="grid gap-5" @submit="submitTotp">
      <UFormField :label="$t('auth.totpTitle')" name="totp" required>
        <UInput
          id="totp-code" v-model="totpState.code" inputmode="numeric" autocomplete="one-time-code"
          dir="ltr" class="w-full text-start"
        />
        <template #hint><span>{{ $t('auth.totpHint') }}</span></template>
      </UFormField>
      <UAlert v-if="errorMessage" role="alert" color="error" variant="subtle" :title="errorMessage" />
      <UButton type="submit" size="lg" class="w-full justify-center" :loading="pending" :label="$t('auth.continue')" />
    </UForm>
  </SharedStandalonePage>
</template>
