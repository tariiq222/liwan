<script setup lang="ts">
import type { AiTenantConfig } from '@liwan/contracts'
import { useRemoveAiKey, useSaveAiKey } from '@/composables/ai/useAiSettings'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'

// The tenant's own provider key. It is write-only: once saved, only the provider, the model and its last four characters
// come back, and typing a new key replaces it. Removing it stops tenant-key runs until a new key is saved. A provider that
// takes its own endpoint (any OpenAI-compatible service) also asks for its base URL, which is not secret and comes back.
const props = defineProps<{ config: AiTenantConfig }>()
const { t, te } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const saving = useSaveAiKey()
const removing = useRemoveAiKey()

const keyProviders = computed(() => props.config.providers.filter(item => item.needs_api_key))
const providers = computed(() => keyProviders.value.map(item => ({ value: item.name, label: te(`ai.settings.key.providers.${item.name}`) ? t(`ai.settings.key.providers.${item.name}`) : item.name })))
const provider = ref(props.config.key.provider ?? providers.value[0]?.value ?? '')
const model = ref(props.config.key.model ?? '')
const baseUrl = ref(props.config.key.base_url ?? '')
const needsBaseUrl = computed(() => keyProviders.value.some(item => item.name === provider.value && item.needs_base_url))
const apiKey = ref('')
const failure = ref('')
const confirmingRemove = ref(false)
const busy = computed(() => !hydrated.value || saving.isPending.value || removing.isPending.value)
const ready = computed(() => !!provider.value && model.value.trim().length > 0 && apiKey.value.length > 0 && (!needsBaseUrl.value || baseUrl.value.trim().length > 0))

// A refused base URL says why; any other refusal keeps the generic text.
function keyErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.field === 'base_url') return t(error.code === 'ai_base_url_not_public' ? 'ai.settings.key.baseUrlNotPublic' : 'ai.settings.key.baseUrlInvalid')
  return saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
}

async function saveKey() {
  if (!ready.value) return
  failure.value = ''
  try {
    await saving.mutateAsync({ provider: provider.value, model: model.value.trim(), api_key: apiKey.value, ...(needsBaseUrl.value ? { base_url: baseUrl.value.trim() } : {}) })
    apiKey.value = ''
    toast.add({ title: t('ai.settings.key.saved'), color: 'success' })
  } catch (error) {
    failure.value = keyErrorMessage(error)
  }
}

async function removeKey() {
  failure.value = ''
  try {
    await removing.mutateAsync()
    confirmingRemove.value = false
    toast.add({ title: t('ai.settings.key.removed'), color: 'success' })
  } catch (error) {
    failure.value = keyErrorMessage(error)
  }
}
</script>

<template>
  <SharedRecordSection id="key" variant="panel" class="liwan-settings-anchor" :title="t('ai.settings.key.title')" :description="t('ai.settings.key.hint')" data-testid="ai-settings-key">
    <template #actions>
      <UBadge v-if="config.key.configured" color="success" variant="subtle" class="rounded-full" :label="t('ai.settings.key.configured', { last4: config.key.last4 })" />
      <UBadge v-else color="neutral" variant="subtle" class="rounded-full" :label="t('ai.settings.key.missing')" />
    </template>
    <form class="liwan-form grid gap-4" novalidate @submit.prevent="saveKey">
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('app.saveFailed')" :description="failure" />
      <div class="liwan-setting-rows">
        <UFormField orientation="horizontal" :label="t('ai.settings.key.provider')" name="provider">
          <USelect id="ai-key-provider" v-model="provider" class="w-full" :items="providers" :disabled="busy" :aria-label="t('ai.settings.key.provider')" />
        </UFormField>
        <UFormField v-if="needsBaseUrl" orientation="horizontal" :label="t('ai.settings.key.baseUrl')" name="base_url" :description="t('ai.settings.key.baseUrlHint')">
          <UInput id="ai-key-base-url" v-model="baseUrl" type="url" class="w-full" dir="ltr" autocomplete="off" placeholder="https://api.example.com/v1" :disabled="busy" maxlength="512" />
        </UFormField>
        <UFormField orientation="horizontal" :label="t('ai.settings.key.model')" name="model" :description="t('ai.settings.key.modelHint')">
          <UInput id="ai-key-model" v-model="model" class="w-full" dir="ltr" autocomplete="off" :disabled="busy" maxlength="128" />
        </UFormField>
        <UFormField orientation="horizontal" :label="t('ai.settings.key.value')" name="api_key" :description="t('ai.settings.key.valueHint')">
          <UInput id="ai-key-value" v-model="apiKey" type="password" class="w-full" dir="ltr" autocomplete="new-password" :disabled="busy" maxlength="512" />
        </UFormField>
      </div>
      <SharedInlineConfirm
        v-if="confirmingRemove"
        :title="t('ai.settings.key.removeTitle')"
        :description="t('ai.settings.key.removeHint')"
        :confirm-label="t('ai.settings.key.remove')"
        :pending="removing.isPending.value"
        @confirm="removeKey"
        @cancel="confirmingRemove = false"
      />
      <SharedFormActions>
        <UButton v-if="config.key.configured && !confirmingRemove" type="button" color="error" variant="outline" :label="t('ai.settings.key.remove')" :disabled="busy" @click="confirmingRemove = true" />
        <UButton type="submit" class="ms-auto" :loading="saving.isPending.value" :disabled="busy || !ready" :label="t('ai.settings.key.save')" />
      </SharedFormActions>
    </form>
  </SharedRecordSection>
</template>
