<script setup lang="ts">
import type { ChatMessageDeleteMode, ChatSettings } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useSaveChatSettings } from '@/composables/useChatSettings'
import { saveErrorMessage } from '@/utils/formFeedback'

// What deleting a message does in this company. A save carries the revision the card was made from; when another
// session saved first the server answers 409, the card reads the saved settings again and tells the manager.
const props = defineProps<{ settings: ChatSettings; reloadSettings: () => Promise<ChatSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const save = useSaveChatSettings()

const baseline = ref(props.settings)
const mode = ref<ChatMessageDeleteMode>(props.settings.values.message_delete_mode)
const reloading = ref(false)
const notice = ref<'conflict' | 'reloadFailed' | null>(null)
const failure = ref<string | null>(null)

const dirty = computed(() => mode.value !== baseline.value.values.message_delete_mode)
const busy = computed(() => !hydrated.value || save.isPending.value || reloading.value)
const items = computed(() => baseline.value.options.message_delete_mode.map(value => ({
  value,
  label: t(`chatSettings.delete.${value}`),
  description: t(`chatSettings.delete.${value}Hint`),
})))

function adopt(settings: ChatSettings) {
  baseline.value = settings
  mode.value = settings.values.message_delete_mode
}
// A refresh of the settings reaches a card with no edits; a draft in progress is kept and saves against its revision.
watch(() => props.settings, (settings) => {
  if (!dirty.value && !busy.value) adopt(settings)
})

async function readSavedSettings() {
  reloading.value = true
  try {
    adopt(await props.reloadSettings())
    notice.value = 'conflict'
  } catch {
    notice.value = 'reloadFailed'
  } finally {
    reloading.value = false
  }
}

async function submit() {
  if (busy.value || !dirty.value) return
  failure.value = null
  notice.value = null
  try {
    adopt(await save.mutateAsync({ revision: baseline.value.revision, values: { message_delete_mode: mode.value } }))
    toast.add({ title: t('chatSettings.saved'), color: 'success' })
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return readSavedSettings()
    failure.value = saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
  }
}
</script>

<template>
  <UForm novalidate :state="{ mode }" class="liwan-form" method="post" data-testid="chat-delete-mode" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('chatSettings.delete.title')" :description="t('chatSettings.delete.hint')">
      <UAlert v-if="notice === 'conflict'" role="status" color="warning" variant="subtle" icon="i-lucide-refresh-cw" :title="t('chatSettings.conflict')" data-testid="chat-delete-mode-conflict" />
      <UAlert v-else-if="notice === 'reloadFailed'" role="alert" color="error" variant="subtle" :title="t('chatSettings.reloadFailed')" data-testid="chat-delete-mode-reload-error" />
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('chatSettings.saveFailed')" :description="failure" data-testid="chat-delete-mode-error" />
      <UFormField :label="t('chatSettings.delete.label')" name="message_delete_mode">
        <URadioGroup v-model="mode" :items="items" :disabled="busy" data-testid="chat-delete-mode-options" />
      </UFormField>
    </SharedFormSection>
    <SharedFormActions>
      <UButton type="submit" class="ms-auto" :loading="save.isPending.value" :disabled="busy || !dirty" :label="t('app.saveChanges')" data-testid="chat-delete-mode-save" />
    </SharedFormActions>
  </UForm>
</template>
