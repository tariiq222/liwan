<script setup lang="ts">
import type { AiTenantConfig } from '@liwan/contracts'
import { useRemoveAiKey, useSaveAiKey } from '@/composables/ai/useAiSettings'
import { saveErrorMessage } from '@/utils/formFeedback'

// The tenant's own provider key. It is write-only: once saved, only the provider, the model and its last four characters
// come back, and typing a new key replaces it. Removing it stops tenant-key runs until a new key is saved.
const props = defineProps<{ config: AiTenantConfig }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const saving = useSaveAiKey()
const removing = useRemoveAiKey()

const providers = computed(() => props.config.providers.filter(item => item.needs_api_key).map(item => ({ value: item.name, label: item.name })))
const provider = ref(props.config.key.provider ?? providers.value[0]?.value ?? '')
const model = ref(props.config.key.model ?? '')
const apiKey = ref('')
const failure = ref('')
const confirmingRemove = ref(false)
const busy = computed(() => !hydrated.value || saving.isPending.value || removing.isPending.value)
const ready = computed(() => !!provider.value && model.value.trim().length > 0 && apiKey.value.length > 0)

async function saveKey() {
  if (!ready.value) return
  failure.value = ''
  try {
    await saving.mutateAsync({ provider: provider.value, model: model.value.trim(), api_key: apiKey.value })
    apiKey.value = ''
    toast.add({ title: t('ai.settings.key.saved'), color: 'success' })
  } catch (error) {
    failure.value = saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
  }
}

async function removeKey() {
  failure.value = ''
  try {
    await removing.mutateAsync()
    confirmingRemove.value = false
    toast.add({ title: t('ai.settings.key.removed'), color: 'success' })
  } catch (error) {
    failure.value = saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
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
