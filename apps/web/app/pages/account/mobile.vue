<script setup lang="ts">
import { MobileSchema } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { normalizeMobileInput, useSaveOwnMobile } from '@/composables/useMe'
import { useSignOut } from '@/composables/useSignOut'
import { postLoginPath } from '~/utils/accessPolicy'

// The mobile step: every account needs a number. While the server says one is required this is the only page
// (besides sign-out) that opens; afterwards it is where the holder changes the number.
definePageMeta({ layout: false })

const { t } = useI18n()
const route = useRoute()
const toast = useToast()
const { me } = useMe()
const saveOwnMobile = useSaveOwnMobile()
const signOutOfSession = useSignOut()
const required = computed(() => me.value?.mobile_required === true)
const mobile = ref(me.value?.mobile ?? '')
const pending = ref(false)
const refusal = ref<'mobileInvalid' | 'mobileTaken' | null>(null)
const failed = ref(false)
const signOutFailed = ref(false)
const hydrated = useHydrated()

const mobileValue = computed(() => normalizeMobileInput(mobile.value))
const mobileOk = computed(() => MobileSchema.safeParse(mobileValue.value).success)
const mobileError = computed(() => refusal.value ?? (mobile.value.trim() && !mobileOk.value ? 'mobileInvalid' : null))
const canSubmit = computed(() => mobileOk.value && !pending.value && hydrated.value)

async function submit() {
  if (!canSubmit.value) return
  pending.value = true
  refusal.value = null
  failed.value = false
  const wasRequired = required.value
  try {
    await saveOwnMobile(mobileValue.value)
    if (!wasRequired) toast.add({ title: t('accountLink.mobileStep.saved'), color: 'success' })
    await navigateTo(wasRequired ? postLoginPath(me.value, route.query.next) : '/account/settings')
  } catch (error) {
    if (error instanceof ApiError && error.code === 'invalid_mobile') refusal.value = 'mobileInvalid'
    else if (error instanceof ApiError && error.code === 'mobile_taken') refusal.value = 'mobileTaken'
    else failed.value = true
  } finally {
    pending.value = false
  }
}

// Sign-out stays reachable here: it is one of the few routes that answers while the number is missing.
async function signOut() {
  signOutFailed.value = false
  signOutFailed.value = !(await signOutOfSession())
}
</script>

<template>
  <SharedStandalonePage :title="required ? t('accountLink.mobileStep.title') : t('accountLink.mobileStep.titleChange')">
    <form class="liwan-form" novalidate @submit.prevent="submit">
      <p class="-mt-2 text-center text-sm text-muted">{{ t('accountLink.mobileStep.subtitle') }}</p>
      <UFormField :label="t('accountLink.mobileLabel')" name="mobile" :help="t('accountLink.mobileHint')" :error="mobileError ? t(`accountLink.${mobileError}`) : undefined" required>
        <UInput id="mobile" v-model="mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="+966 5X XXX XXXX" dir="ltr" class="w-full text-start" :disabled="!hydrated" />
      </UFormField>
      <UAlert v-if="failed" role="alert" color="warning" variant="subtle" icon="i-lucide-cloud-off" :title="t('accountLink.unavailableTitle')" :description="t('accountLink.unavailableBody')" />
      <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!canSubmit" :loading="pending" :label="required ? t('accountLink.mobileStep.submit') : t('accountLink.mobileStep.save')" />
      <UButton v-if="required" type="button" color="neutral" variant="link" class="justify-center" :disabled="!hydrated" :label="t('accountLink.mobileStep.signOut')" @click="signOut" />
      <UButton v-else to="/account/settings" color="neutral" variant="link" class="justify-center" :label="t('accountLink.mobileStep.back')" />
      <UAlert v-if="signOutFailed" role="alert" color="error" variant="subtle" :title="t('accountLink.mobileStep.signOutFailed')" />
    </form>
  </SharedStandalonePage>
</template>
