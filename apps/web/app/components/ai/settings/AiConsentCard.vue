<script setup lang="ts">
import type { AiSettings } from '@liwan/contracts'
import { useRevokeAiConsent, useSignAiConsent } from '@/composables/ai/useAiSettings'
import { saveErrorMessage } from '@/utils/formFeedback'

// The AI use acknowledgement and liability disclaimer (spec 2026-11-04 §6.8): no AI runs for the tenant, on any provider,
// until an authorized user signs it. The signature names the exact text shown here (its version and hash); a new text
// version needs a new signature, and revoking it stops the assistant at once.
const props = defineProps<{ settings: AiSettings }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const signing = useSignAiConsent()
const revoking = useRevokeAiConsent()
const failure = ref('')
const confirmingRevoke = ref(false)
const accepted = ref(false)

const consent = computed(() => props.settings.consent)
const text = computed(() => (locale.value === 'ar' ? consent.value.text_ar : consent.value.text_en))
const busy = computed(() => !hydrated.value || signing.isPending.value || revoking.isPending.value)
const signedAt = computed(() => consent.value.signed ? new Date(consent.value.signed.signed_at).toLocaleDateString(locale.value) : '')

async function sign() {
  failure.value = ''
  try {
    await signing.mutateAsync({ text_version: consent.value.required_version, text_hash: consent.value.text_hash })
    accepted.value = false
    toast.add({ title: t('ai.settings.consent.signed'), color: 'success' })
  } catch (error) {
    failure.value = saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
  }
}

async function revoke() {
  failure.value = ''
  try {
    await revoking.mutateAsync()
    confirmingRevoke.value = false
    toast.add({ title: t('ai.settings.consent.revoked'), color: 'success' })
  } catch (error) {
    failure.value = saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
  }
}
</script>

<template>
  <SharedRecordSection id="consent" variant="panel" class="liwan-settings-anchor" :title="t('ai.settings.consent.title')" :description="t('ai.settings.consent.hint')" data-testid="ai-settings-consent">
    <template #actions>
      <UBadge v-if="consent.signed" color="success" variant="subtle" :label="t('ai.settings.consent.active')" />
      <UBadge v-else color="warning" variant="subtle" :label="t('ai.settings.consent.required')" />
    </template>
    <div class="grid gap-4">
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('app.saveFailed')" :description="failure" />
      <UAlert v-if="!consent.signed" color="warning" variant="subtle" icon="i-lucide-shield-alert" :title="t('ai.settings.consent.required')" :description="t('ai.settings.consent.requiredHint')" />
      <p v-if="consent.signed" class="text-sm text-muted" data-testid="ai-consent-signed">
        {{ t('ai.settings.consent.signedBy', { name: consent.signed.user.name, date: signedAt }) }}
      </p>
      <div class="rounded-(--liwan-radius-card) border border-default bg-muted/40 p-4 text-sm leading-7 whitespace-pre-line" data-testid="ai-consent-text">{{ text }}</div>
      <template v-if="!consent.signed">
        <UCheckbox v-model="accepted" :label="t('ai.settings.consent.accept')" :disabled="busy" />
        <SharedFormActions>
          <UButton type="button" class="ms-auto" color="warning" :loading="signing.isPending.value" :disabled="busy || !accepted" :label="t('ai.settings.consent.sign')" @click="sign" />
        </SharedFormActions>
      </template>
      <template v-else>
        <SharedInlineConfirm
          v-if="confirmingRevoke"
          color="warning"
          :title="t('ai.settings.consent.revokeTitle')"
          :description="t('ai.settings.consent.revokeHint')"
          :confirm-label="t('ai.settings.consent.revoke')"
          :pending="revoking.isPending.value"
          @confirm="revoke"
          @cancel="confirmingRevoke = false"
        />
        <SharedFormActions v-else>
          <UButton type="button" class="ms-auto" color="neutral" variant="outline" :disabled="busy" :label="t('ai.settings.consent.revoke')" @click="confirmingRevoke = true" />
        </SharedFormActions>
      </template>
    </div>
  </SharedRecordSection>
</template>
