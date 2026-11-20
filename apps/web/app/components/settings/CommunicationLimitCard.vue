<script setup lang="ts">
import { IntegrationCommunicationSettingsSchema } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useCommunicationSettings, useUpdateCommunicationSettings } from '@/composables/useIntegrationCommunications'
import { integrationErrorText, integrationServerMessage } from '@/utils/integrationLabels'

// The company's daily message limit: the safety stop that protects the Twilio balance from a loop. The server counts the
// day's messages from the log and refuses the next one once the limit is reached. The server's answer replaces the
// cached value, so the card shows what is stored. Reading needs integrations.read; changing it needs integrations.manage.
const props = defineProps<{ canManage: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const settings = useCommunicationSettings()
const update = useUpdateCommunicationSettings()
const idBase = useId()
// The limits of the contract: a whole number from 1 to 100000.
const { min, max } = { min: 1, max: 100000 }

const draft = ref('')
const error = ref('')
const saved = ref(false)
const stored = computed(() => settings.data.value?.daily_message_limit)
watch(stored, value => { if (value !== undefined) draft.value = String(value) }, { immediate: true })
const parsed = computed(() => (/^\d+$/.test(draft.value.trim()) ? Number(draft.value.trim()) : null))
const changed = computed(() => parsed.value !== stored.value)
const locked = computed(() => !hydrated.value || !props.canManage || update.isPending.value)
watch(draft, () => { error.value = ''; saved.value = false })

async function save() {
  if (locked.value || !changed.value) return
  error.value = ''
  const body = { daily_message_limit: parsed.value ?? NaN }
  if (!IntegrationCommunicationSettingsSchema.safeParse(body).success) {
    error.value = t('integrations.communications.limit.invalid', { min, max })
    document.getElementById(`${idBase}-limit`)?.focus()
    return
  }
  try {
    await update.mutateAsync(body)
    saved.value = true
    toast.add({ title: t('integrations.communications.limit.saved'), color: 'success' })
  } catch (failure) {
    error.value = failure instanceof ApiError && failure.field === 'daily_message_limit'
      ? integrationServerMessage(failure) || t('integrations.communications.limit.invalid', { min, max })
      : integrationErrorText(failure, t)
  }
}
</script>

<template>
  <SharedRecordSection id="limit" variant="panel" class="liwan-settings-anchor" :title="t('integrations.communications.limit.title')" :description="t('integrations.communications.limit.hint')" data-testid="communication-limit">
    <SharedPageState :loading="settings.isLoading.value" :error="settings.error.value" @retry="settings.refetch()">
      <UForm :state="{ draft }" class="grid gap-4 text-start" novalidate :loading-auto="false" @submit="save">
        <SharedUnsavedChanges :dirty="changed && canManage" />
        <UFormField :label="t('integrations.communications.limit.label')" :description="t('integrations.communications.limit.fieldHint', { min, max })" name="daily_message_limit" :error="error">
          <UInput :id="`${idBase}-limit`" v-model="draft" type="text" inputmode="numeric" dir="ltr" class="w-full sm:max-w-48" :disabled="locked" data-testid="communication-limit-input" />
        </UFormField>
        <div v-if="canManage" class="flex flex-wrap items-center justify-end gap-3">
          <p v-if="saved && !changed" class="text-sm text-muted" role="status" data-testid="communication-limit-saved">{{ t('integrations.communications.limit.saved') }}</p>
          <UButton type="submit" color="primary" :disabled="locked || !changed" :loading="update.isPending.value" :label="t('integrations.communications.limit.save')" data-testid="communication-limit-save" />
        </div>
      </UForm>
    </SharedPageState>
  </SharedRecordSection>
</template>
