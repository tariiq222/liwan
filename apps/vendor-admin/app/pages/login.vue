<script setup lang="ts">
definePageMeta({ layout: false, public: true })

const { t } = useI18n()
useHead(() => ({ title: `${t('adminAuth.login.title')} · ${t('app.productName')}` }))

const { mode, pending, errorKey, form, signInWithPasskey, signInWithPassword, setMode } = useSignIn()
// A native form submit before hydration would put the password in the address.
const hydrated = useHydrated()
</script>

<template>
  <SharedStandalonePage>
    <template #header>
      <div class="flex flex-col items-center text-center">
        <SharedBrandWordmark size="lg" class="mb-3" />
        <h1 class="text-2xl font-semibold text-highlighted">
          {{ t('adminAuth.login.title') }}
        </h1>
        <p class="text-sm text-muted">
          {{ t('adminAuth.login.subtitle') }}
        </p>
      </div>
    </template>

    <div class="grid gap-5">
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="t(errorKey)" />

      <template v-if="mode === 'passkey'">
        <PasskeyButton :label="t('adminAuth.login.passkey')" :pending="pending" @click="signInWithPasskey" />
        <p class="text-center text-sm text-muted">
          {{ t('adminAuth.login.passkeyHint') }}
        </p>
        <div class="grid gap-1">
          <UButton type="button" variant="link" color="neutral" class="justify-center" :label="t('adminAuth.login.lostDevice')" @click="setMode('fallback')" />
          <UButton type="button" variant="link" color="neutral" class="justify-center" :label="t('adminAuth.login.useRecoveryCode')" @click="setMode('recovery')" />
        </div>
      </template>

      <UForm v-else novalidate :state="form" class="grid gap-5" @submit="signInWithPassword">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            {{ mode === 'recovery' ? t('adminAuth.login.recoveryTitle') : t('adminAuth.login.fallbackTitle') }}
          </h2>
          <p class="text-sm text-muted">
            {{ mode === 'recovery' ? t('adminAuth.login.recoveryHint') : t('adminAuth.login.fallbackHint') }}
          </p>
        </div>
        <UFormField :label="t('adminAuth.login.email')" name="email" required>
          <UInput id="email" v-model="form.email" type="email" autocomplete="username" dir="ltr" class="w-full text-start" />
        </UFormField>
        <UFormField :label="t('adminAuth.login.password')" name="password" required>
          <UInput id="password" v-model="form.password" type="password" autocomplete="current-password" dir="ltr" class="w-full" />
        </UFormField>
        <UFormField v-if="mode === 'fallback'" :label="t('adminAuth.login.totpCode')" name="totpCode" required>
          <UInput id="totp-code" v-model="form.totpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" class="w-full text-start" />
        </UFormField>
        <UFormField v-else :label="t('adminAuth.login.recoveryCode')" name="recoveryCode" required>
          <UInput id="recovery-code" v-model="form.recoveryCode" autocomplete="off" autocapitalize="none" maxlength="14" dir="ltr" class="w-full text-start" />
        </UFormField>
        <UButton type="submit" class="w-full justify-center" :disabled="!hydrated" :loading="pending" :label="t('adminAuth.login.submit')" />
        <UButton type="button" variant="link" color="neutral" class="justify-center" :label="t('adminAuth.login.backToPasskey')" @click="setMode('passkey')" />
      </UForm>
    </div>
  </SharedStandalonePage>
</template>
