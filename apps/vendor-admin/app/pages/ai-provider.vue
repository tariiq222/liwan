<script setup lang="ts">
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import type { AiProviderTestResult } from '@liwan/commercial-contracts'
import { aiProviderErrorKey, draftComplete, modelsFields, probeFields, storedKeyApplies, testSignature, type ProviderDraft } from '@/utils/aiProvider'
import { useAiProvider } from '@/composables/useAiProvider'

definePageMeta({ capability: 'vendor.ai.manage' })
const { t } = useI18n()
const api = useAiProvider()
const hydrated = useHydrated()
const REASON_MIN = 3

const { data, error, pending, refresh } = await useAsyncData('vendor:ai-provider', async () => {
  const [current, presets] = await Promise.all([api.current(), api.presets()])
  return { setting: current.setting, presets: presets.items }
})
const setting = computed(() => data.value?.setting ?? null)
const presets = computed(() => data.value?.presets ?? [])

const draft = reactive<ProviderDraft>({ preset: '', base_url: '', api_key: '', model: '', stream_usage: false })
const reason = ref('')
const models = ref<string[]>([])
const testResult = ref<AiProviderTestResult | null>(null)
const testedSignature = ref<string | null>(null)
const failure = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref<'models' | 'test' | 'save' | null>(null)
const confirming = ref(false)

function restoreSaved() {
  draft.preset = setting.value?.preset ?? ''
  draft.base_url = setting.value?.base_url ?? ''
  draft.api_key = ''
  draft.model = setting.value?.model ?? ''
  draft.stream_usage = setting.value?.stream_usage ?? false
  models.value = setting.value ? [setting.value.model] : []
}
watch(data, restoreSaved, { immediate: true })

const preset = computed(() => presets.value.find(item => item.id === draft.preset))
const presetItems = computed(() => presets.value.map(item => ({ label: item.label, value: item.id })))
const modelItems = computed(() => [...new Set([...(draft.model ? [draft.model] : []), ...models.value])].map(id => ({ label: id, value: id })))
const keyStored = computed(() => storedKeyApplies(setting.value, draft, preset.value))
const complete = computed(() => draftComplete(draft, preset.value, keyStored.value))
const canLoadModels = computed(() => draftComplete({ ...draft, model: 'any' }, preset.value, keyStored.value))
const tested = computed(() => testResult.value?.ok === true && testedSignature.value === testSignature(draft))
const reasonValid = computed(() => reason.value.trim().length >= REASON_MIN)
const dirty = computed(() => Boolean(draft.api_key) || draft.preset !== (setting.value?.preset ?? '') || draft.model !== (setting.value?.model ?? '') || draft.base_url !== (setting.value?.base_url ?? '') || (Boolean(setting.value) && draft.stream_usage !== setting.value?.stream_usage))

function choosePreset(id: string) {
  const sameAsSaved = setting.value?.preset === id
  draft.preset = id
  draft.api_key = ''
  draft.base_url = sameAsSaved ? setting.value?.base_url ?? '' : ''
  draft.model = sameAsSaved ? setting.value?.model ?? '' : ''
  draft.stream_usage = sameAsSaved && setting.value ? setting.value.stream_usage : (presets.value.find(item => item.id === id)?.stream_usage ?? false)
  models.value = sameAsSaved && setting.value ? [setting.value.model] : []
  testResult.value = null
  confirming.value = false
  failure.value = null
}

async function run<T>(what: 'models' | 'test' | 'save', action: () => Promise<T>): Promise<T | undefined> {
  if (!hydrated.value || busy.value) return undefined
  busy.value = what
  failure.value = null
  notice.value = null
  try { return await action() }
  catch (cause) { failure.value = aiProviderErrorKey(cause); return undefined }
  finally { busy.value = null }
}

async function loadModels() {
  const loaded = await run('models', () => api.models(modelsFields(draft, preset.value)))
  if (loaded) models.value = loaded.items.map(item => item.id)
}

async function testConnection() {
  const result = await run('test', () => api.test({ ...probeFields(draft, preset.value), model: draft.model.trim() }))
  if (!result) return
  testResult.value = result
  testedSignature.value = testSignature(draft)
}

async function save() {
  if (!tested.value || !reasonValid.value) return
  const saved = await run('save', () => api.save({ ...probeFields(draft, preset.value), model: draft.model.trim(), reason: reason.value.trim() }))
  if (!saved) return
  confirming.value = false
  reason.value = ''
  testResult.value = null
  notice.value = t('aiProvider.form.saved', { revision: saved.setting?.revision ?? 0 })
  await refresh()
}

const presetLabel = (id: string) => presets.value.find(item => item.id === id)?.label ?? id
</script>

<template>
  <SharedRecordPage :title="t('aiProvider.title')" :loading="pending && !data" :error="error" @retry="refresh">
    <SharedUnsavedChanges :dirty="dirty" />
    <p class="max-w-3xl text-sm text-muted">{{ t('aiProvider.intro') }}</p>

    <SharedFormSection panel :title="t('aiProvider.current.title')">
      <p v-if="!setting" class="text-sm text-muted" data-testid="ai-provider-none">{{ t('aiProvider.current.none') }}</p>
      <template v-else>
        <dl class="grid gap-3 sm:grid-cols-2" data-testid="ai-provider-current">
          <div><dt class="text-xs text-muted">{{ t('aiProvider.current.provider') }}</dt><dd class="font-medium text-highlighted">{{ presetLabel(setting.preset) }}</dd></div>
          <div><dt class="text-xs text-muted">{{ t('aiProvider.current.model') }}</dt><dd class="font-medium text-highlighted" dir="ltr">{{ setting.model }}</dd></div>
          <div v-if="setting.base_url"><dt class="text-xs text-muted">{{ t('aiProvider.current.endpoint') }}</dt><dd class="font-medium text-highlighted" dir="ltr">{{ setting.base_url }}</dd></div>
          <div><dt class="text-xs text-muted">{{ t('aiProvider.current.key') }}</dt><dd class="font-medium text-highlighted">{{ setting.key.configured ? t('aiProvider.current.keyConfigured', { last4: setting.key.last4 }) : t('aiProvider.current.keyNone') }}</dd></div>
          <div v-if="setting.provider === 'openai_compatible'"><dt class="text-xs text-muted">{{ t('aiProvider.current.tokenCounts') }}</dt><dd class="font-medium text-highlighted">{{ setting.stream_usage ? t('aiProvider.current.tokenCountsAsked') : t('aiProvider.current.tokenCountsNotAsked') }}</dd></div>
          <div><dt class="text-xs text-muted">{{ t('aiProvider.current.revision') }}</dt><dd class="font-medium text-highlighted">{{ setting.revision }}</dd></div>
          <div><dt class="text-xs text-muted">{{ t('aiProvider.current.updated') }}</dt><dd class="font-medium text-highlighted">{{ formatDateTime(setting.updated_at) }}</dd></div>
        </dl>
        <UAlert
          class="mt-3" :color="setting.delivery === 'delivered' ? 'success' : 'warning'" variant="subtle" :icon="setting.delivery === 'delivered' ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
          :title="t(`aiProvider.current.delivery.${setting.delivery}`)" data-testid="ai-provider-delivery"
        />
      </template>
    </SharedFormSection>

    <SharedFormSection panel :title="t('aiProvider.form.title')" :description="t('aiProvider.form.description')">
      <form class="grid max-w-2xl gap-4" novalidate @submit.prevent="testConnection">
        <UAlert v-if="notice" role="status" color="success" variant="subtle" icon="i-lucide-check" :title="notice" data-testid="ai-provider-notice" />
        <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t(failure)" data-testid="ai-provider-error" />

        <UFormField :label="t('aiProvider.form.preset')" required>
          <USelect :model-value="draft.preset || undefined" :items="presetItems" :placeholder="t('aiProvider.form.presetPlaceholder')" class="w-full" :disabled="!hydrated || Boolean(busy)" data-testid="ai-provider-preset" @update:model-value="choosePreset($event as string)" />
        </UFormField>

        <UFormField v-if="preset?.needs_base_url" :label="t('aiProvider.form.baseUrl')" :hint="t(preset.provider === 'ollama' ? 'aiProvider.form.baseUrlHintPrivate' : 'aiProvider.form.baseUrlHintPublic')" required>
          <UInput v-model="draft.base_url" dir="ltr" type="url" maxlength="512" autocomplete="off" class="w-full" :disabled="!hydrated || Boolean(busy)" data-testid="ai-provider-base-url" />
        </UFormField>

        <UFormField v-if="preset?.needs_api_key" :label="t('aiProvider.form.apiKey')" :hint="keyStored ? t('aiProvider.form.apiKeyKeep', { last4: setting?.key.last4 }) : t('aiProvider.form.apiKeyHint')" :required="!keyStored">
          <UInput v-model="draft.api_key" dir="ltr" type="password" maxlength="512" autocomplete="new-password" class="w-full" :disabled="!hydrated || Boolean(busy)" data-testid="ai-provider-key" />
        </UFormField>

        <template v-if="preset">
          <UFormField v-if="preset.stream_usage_editable" :description="t('aiProvider.form.streamUsageHint')">
            <UCheckbox v-model="draft.stream_usage" :label="t('aiProvider.form.streamUsage')" :disabled="!hydrated || Boolean(busy)" data-testid="ai-provider-stream-usage" />
          </UFormField>
          <UFormField :label="t('aiProvider.form.model')" required>
            <div class="flex flex-wrap items-start gap-2">
              <USelect v-model="draft.model" :items="modelItems" :placeholder="t('aiProvider.form.modelPlaceholder')" class="min-w-0 flex-1" :disabled="!hydrated || Boolean(busy)" data-testid="ai-provider-model" />
              <UButton type="button" color="neutral" variant="outline" icon="i-lucide-list-restart" :loading="busy === 'models'" :disabled="!hydrated || Boolean(busy) || !canLoadModels" data-testid="ai-provider-load-models" @click="loadModels">{{ t('aiProvider.form.loadModels') }}</UButton>
            </div>
          </UFormField>
          <p v-if="models.length > 1" class="text-xs text-muted">{{ t('aiProvider.form.modelsLoaded', { count: models.length }) }}</p>

          <div class="flex flex-wrap items-center gap-3">
            <UButton type="submit" color="neutral" variant="outline" icon="i-lucide-plug-zap" :loading="busy === 'test'" :disabled="!hydrated || Boolean(busy) || !complete" data-testid="ai-provider-test">{{ t('aiProvider.form.test') }}</UButton>
            <p v-if="testResult?.ok && tested" class="text-sm text-success" role="status" data-testid="ai-provider-test-ok">{{ t('aiProvider.form.testPassed', { ms: testResult.latency_ms }) }}</p>
            <p v-else-if="testResult && !testResult.ok && testedSignature === testSignature(draft)" class="text-sm text-error" role="alert" data-testid="ai-provider-test-failed">{{ t('aiProvider.form.testFailed') }}: {{ t(`aiProvider.test.${testResult.code}`) }}</p>
            <p v-else-if="complete" class="text-sm text-muted">{{ t('aiProvider.form.testNeeded') }}</p>
          </div>

          <UAlert
            v-if="tested && testResult?.ok && !testResult.usage_reported" role="alert" color="warning" variant="subtle" icon="i-lucide-triangle-alert"
            :title="t('aiProvider.form.noUsageTitle')" :description="t('aiProvider.form.noUsageDescription')" data-testid="ai-provider-no-usage"
          />

          <div class="flex justify-end">
            <UButton v-if="!confirming" type="button" icon="i-lucide-save" :disabled="!hydrated || Boolean(busy) || !tested" data-testid="ai-provider-save" @click="confirming = true">{{ t('aiProvider.form.save') }}</UButton>
          </div>
          <SharedInlineConfirm
            v-if="confirming" :title="t('aiProvider.form.confirmTitle')" :description="t('aiProvider.form.confirmDescription')" :confirm-label="t('aiProvider.form.confirm')"
            :pending="busy === 'save'" :disabled="!reasonValid || !tested" color="warning" @confirm="save" @cancel="confirming = false"
          >
            <UFormField class="mt-3" :label="t('aiProvider.form.reason')" :hint="t('aiProvider.form.reasonHint')" required>
              <UInput v-model="reason" maxlength="1000" class="w-full" :disabled="!hydrated || busy === 'save'" data-testid="ai-provider-reason" />
            </UFormField>
          </SharedInlineConfirm>
        </template>
      </form>
    </SharedFormSection>
  </SharedRecordPage>
</template>
