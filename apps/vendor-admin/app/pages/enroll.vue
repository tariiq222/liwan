<script setup lang="ts">
definePageMeta({ layout: false, public: true })

const { t } = useI18n()
useHead(() => ({ title: `${t('adminAuth.enroll.title')} · ${t('app.productName')}` }))

const {
  step, pending, errorKey, email, label, totpUri, totpSecret, form, recoveryCodes, saved,
  start, loadTotp, registerPasskey, complete, finish,
} = useEnrollment()
const hydrated = useHydrated()
const STEPS = 3
const position = computed(() => ({ passkey: 1, totp: 2, recovery: 3 })[step.value as 'passkey' | 'totp' | 'recovery'])

// The token is read from the address fragment on the client only; the server never sees it.
onMounted(start)
</script>

<template>
  <SharedStandalonePage>
    <template #header>
      <div class="flex flex-col items-center text-center">
        <SharedBrandWordmark size="lg" class="mb-3" />
        <h1 class="text-2xl font-semibold text-highlighted">
          {{ step === 'invalid' ? t('adminAuth.enroll.invalidTitle') : t('adminAuth.enroll.title') }}
        </h1>
        <p class="text-sm text-muted">
          {{ position ? t('adminAuth.enroll.stepOf', { current: position, total: STEPS }) : t('adminAuth.enroll.subtitle') }}
        </p>
      </div>
    </template>

    <div class="grid gap-5">
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="t(errorKey)" />

      <p v-if="step === 'checking'" class="text-center text-sm text-muted" role="status">
        {{ t('adminAuth.enroll.checking') }}
      </p>

      <p v-else-if="step === 'invalid'" class="text-center text-sm text-muted">
        {{ t('adminAuth.enroll.invalidHint') }}
      </p>

      <template v-else-if="step === 'passkey'">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            {{ t('adminAuth.enroll.passkeyTitle') }}
          </h2>
          <p class="text-sm text-muted">
            {{ t('adminAuth.enroll.accountFor', { email }) }}
          </p>
          <p class="text-sm text-muted">
            {{ t('adminAuth.enroll.passkeyLead') }}
          </p>
        </div>
        <UFormField :label="t('adminAuth.enroll.deviceLabel')" :help="t('adminAuth.enroll.deviceLabelHint')" name="label">
          <UInput id="device-label" v-model="label" maxlength="60" autocomplete="off" class="w-full" />
        </UFormField>
        <PasskeyButton :label="t('adminAuth.enroll.registerPasskey')" :pending="pending" @click="registerPasskey" />
      </template>

      <template v-else-if="step === 'totp'">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            {{ t('adminAuth.enroll.totpTitle') }}
          </h2>
          <p class="text-sm text-muted">
            {{ t('adminAuth.enroll.totpLead') }}
          </p>
        </div>
        <TotpSetup :uri="totpUri" :secret="totpSecret" :loading="pending" @retry="loadTotp" />
        <UForm v-if="totpUri" novalidate :state="form" class="grid gap-5" @submit="complete">
          <UFormField :label="t('adminAuth.enroll.password')" :help="t('adminAuth.enroll.passwordHint')" name="password" required>
            <UInput id="new-password" v-model="form.password" type="password" autocomplete="new-password" dir="ltr" class="w-full" />
          </UFormField>
          <UFormField :label="t('adminAuth.enroll.confirm')" name="confirm" required>
            <UInput id="confirm-password" v-model="form.confirm" type="password" autocomplete="new-password" dir="ltr" class="w-full" />
          </UFormField>
          <UFormField :label="t('adminAuth.enroll.totpCode')" :help="t('adminAuth.enroll.totpCodeHint')" name="totpCode" required>
            <UInput id="totp-code" v-model="form.totpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" class="w-full text-start" />
          </UFormField>
          <UButton type="submit" class="w-full justify-center" :disabled="!hydrated" :loading="pending" :label="t('adminAuth.enroll.complete')" />
        </UForm>
      </template>

      <template v-else-if="step === 'recovery'">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            {{ t('adminAuth.enroll.recoveryTitle') }}
          </h2>
          <p class="text-sm text-muted">
            {{ t('adminAuth.enroll.recoveryLead') }}
          </p>
        </div>
        <RecoveryCodes v-model="saved" :codes="recoveryCodes" :pending="pending" @continue="finish" />
      </template>
    </div>
  </SharedStandalonePage>
</template>
