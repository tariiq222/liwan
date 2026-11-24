<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { formatBusinessDateTime } from '@/utils/vendorTime'
import type { AiCapability, AiQuality } from '@liwan/commercial-contracts'
import {
  AI_CAPABILITIES, AI_QUALITY_LEVELS, aiProviderErrorHasSteps, aiProviderErrorKey, aiProviderErrorSection, cellKey, chargeForOneDollar, configDirty, draftFromSetting, effectiveModel, freeId, idProblem, ltr, marginBps,
  modelSaved, modelsOfProvider, modelUsable, priceFilled, priceValid, providerSaved, quickUnmapped, saveBlockers, savePayload, unusableReason, type Blocker, type ConfigDraft, type ModelDraft, type ProviderDraft, type Section,
} from '@/utils/aiProvider'
import { useAiProvider } from '@/composables/useAiProvider'

definePageMeta({ capability: 'vendor.ai.manage' })
const { t } = useI18n()
const api = useAiProvider()
const { can } = useVendorContext()
const canEdit = computed(() => can('vendor.ai.manage'))
const hydrated = useHydrated()
const REASON_MIN = 3
const INHERIT = '__inherit'

const { data, error, pending, refresh } = await useAsyncData('vendor:ai-provider', async () => {
  const [current, presets] = await Promise.all([api.current(), api.presets()])
  return { setting: current.setting, presets: presets.items }
})
const setting = computed(() => data.value?.setting ?? null)
const presets = computed(() => data.value?.presets ?? [])
const presetOf = (id: string) => presets.value.find(item => item.id === id)

const draft = reactive<ConfigDraft>(draftFromSetting(setting.value))
const restore = () => Object.assign(draft, draftFromSetting(setting.value))
// A draft exists once data has arrived once: a first load that failed is filled by the retry, while a refetch after a test keeps unsaved edits.
const draftLoaded = ref(Boolean(data.value))
watch(data, (loaded) => { if (loaded && !draftLoaded.value) { restore(); draftLoaded.value = true } })
const loadedModels = ref<Record<string, string[]>>({})
interface TestView { ok: boolean, usage: boolean, ms: number, code: string }
const testViews = ref<Record<string, TestView>>({})
const failures = ref<Partial<Record<Section, string>>>({})
const notice = ref<string | null>(null)
const busy = ref<string | null>(null)
const reason = ref('')
const confirming = ref(false)
const attempted = ref(false)
const summary = ref<{ focus: () => void } | null>(null)
const redelivering = ref(false)
const redeliverReason = ref('')
const addPreset = ref('')
const addProviderId = ref('')
const addModelId = ref('')
const addModelProvider = ref('')

const dirty = computed(() => configDirty(draft, setting.value))
const blockers = computed(() => saveBlockers(draft, setting.value, presets.value))
const reasonValid = computed(() => reason.value.trim().length >= REASON_MIN)
const redeliverReasonValid = computed(() => redeliverReason.value.trim().length >= REASON_MIN)
const margin = computed(() => marginBps(draft.margin_percent))
const disabled = computed(() => !hydrated.value || Boolean(busy.value))
const presetItems = computed(() => presets.value.map(item => ({ label: item.label, value: item.id })))
const providerItems = computed(() => draft.providers.map(p => ({ label: p.id, value: p.id })))
const usableIds = computed(() => draft.models.filter(m => modelUsable(setting.value, m)).map(m => m.id))
const modelOptions = (current: string) => [...new Set([...usableIds.value, ...(current ? [current] : [])])].map(id => ({ label: id, value: id }))
const cellOptions = (current: string) => [{ label: t('aiProvider.routes.inherit'), value: INHERIT }, ...modelOptions(current)]
const providerIds = computed(() => draft.providers.map(p => p.id))
const modelIds = computed(() => draft.models.map(m => m.id))
const unpricedRouted = computed(() => {
  const routed = new Set([draft.routes.default, ...Object.values(draft.routes.cells)].filter(Boolean))
  return draft.models.filter(m => routed.has(m.id) && !(priceFilled(m.input_price) && priceFilled(m.output_price))).map(m => m.id)
})
const providerReady = (id: string) => draft.providers.some(p => p.id === id && providerSaved(setting.value, p, presets.value))
const columns = computed<TableColumn<ModelDraft>[]>(() => [
  { id: 'id', header: t('aiProvider.models.colId') },
  { id: 'provider', header: t('aiProvider.models.provider') },
  { id: 'model', header: t('aiProvider.models.name') },
  { id: 'input_price', header: t('aiProvider.models.input_price') },
  { id: 'cached_input_price', header: t('aiProvider.models.cached_input_price') },
  { id: 'output_price', header: t('aiProvider.models.output_price') },
  { id: 'actions', header: t('aiProvider.models.actions') },
])
const priceFields = ['input_price', 'cached_input_price', 'output_price'] as const

async function run<T>(what: string, section: Section, action: () => Promise<T>): Promise<T | undefined> {
  if (disabled.value) return undefined
  busy.value = what
  failures.value = { ...failures.value, [section]: undefined, general: undefined }
  notice.value = null
  try {
    const result = await action()
    failures.value = {}
    return result
  }
  catch (cause) { failures.value = { ...failures.value, [aiProviderErrorSection(cause)]: aiProviderErrorKey(cause) }; return undefined }
  finally { busy.value = null }
}

function addProvider() {
  if (!addPreset.value) return
  const id = addProviderId.value.trim() || freeId(addPreset.value, providerIds.value)
  draft.providers.push({ id, preset: addPreset.value, base_url: '', api_key: '', stream_usage: presetOf(addPreset.value)?.stream_usage ?? false })
  addPreset.value = ''
  addProviderId.value = ''
}
const addProviderProblem = computed(() => (addProviderId.value.trim() ? idProblem([...providerIds.value, addProviderId.value.trim()], addProviderId.value.trim()) : null))
function removeProvider(provider: ProviderDraft) {
  if (modelsOfProvider(draft, provider.id).length) return
  draft.providers = draft.providers.filter(p => p.id !== provider.id)
}
function addModel() {
  const id = addModelId.value.trim()
  if (!id || !addModelProvider.value || idProblem([...modelIds.value, id], id)) return
  draft.models.push({ id, provider: addModelProvider.value, model: '', input_price: '', cached_input_price: '', output_price: '' })
  addModelId.value = ''
}
const addModelProblem = computed(() => (addModelId.value.trim() ? idProblem([...modelIds.value, addModelId.value.trim()], addModelId.value.trim()) : null))
function removeModel(model: ModelDraft) {
  draft.models = draft.models.filter(m => m.id !== model.id)
  for (const cell of Object.keys(draft.routes.cells) as Array<keyof ConfigDraft['routes']['cells']>) if (draft.routes.cells[cell] === model.id) draft.routes.cells[cell] = ''
  if (draft.routes.default === model.id) draft.routes.default = ''
}

async function loadModels(provider: ProviderDraft) {
  const loaded = await run(`models:${provider.id}`, 'models', () => api.models(provider.id))
  if (loaded) loadedModels.value = { ...loadedModels.value, [provider.id]: loaded.items.map(item => item.id) }
}
async function testModel(model: ModelDraft) {
  const result = await run(`test:${model.id}`, 'models', () => api.test(model.provider, model.model))
  if (!result) return
  testViews.value = { ...testViews.value, [model.id]: result.ok ? { ok: true, usage: result.usage_reported, ms: result.latency_ms, code: '' } : { ok: false, usage: false, ms: 0, code: result.code } }
  const current = await api.current().catch(() => null)  // the control plane recorded the result: show it without touching the draft
  if (current && data.value) data.value = { ...data.value, setting: current.setting }
}

// The save card keeps its own footer (an action card): the whole-configuration save needs an audit reason, so the footer button opens the confirm step.
async function startSave() {
  if (!dirty.value) return
  attempted.value = true
  if (blockers.value.length) { await nextTick(); summary.value?.focus(); return }
  confirming.value = true
}
function revertDraft() {
  restore()
  confirming.value = false
  attempted.value = false
  reason.value = ''
}

async function save() {
  if (blockers.value.length || !reasonValid.value) return
  const saved = await run('save', 'general', () => api.save(savePayload(draft, presets.value, reason.value)))
  if (!saved) return
  data.value = { presets: presets.value, setting: saved.setting }
  restore()
  confirming.value = false
  attempted.value = false
  reason.value = ''
  testViews.value = {}
  notice.value = t('aiProvider.save.saved', { revision: ltr(saved.setting?.revision ?? 0) })
}

/** Writes what is saved to the file the AI service reads, again. It sends the saved setting, not the form, so it waits for a clean draft. */
async function redeliver() {
  if (dirty.value || !redeliverReasonValid.value) return
  const answer = await run('redeliver', 'general', () => api.redeliver(redeliverReason.value.trim()))
  if (!answer) return
  data.value = { presets: presets.value, setting: answer.setting }
  cancelRedeliver()
  notice.value = t(answer.outcome === 'written' ? 'aiProvider.redeliver.written' : 'aiProvider.redeliver.unchanged', { revision: ltr(answer.setting.revision) })
}
function cancelRedeliver() {
  redelivering.value = false
  redeliverReason.value = ''
}

const presetLabel = (id: string) => presetOf(id)?.label ?? id
const keyState = (provider: ProviderDraft): { text: string, last4: string | null } => {
  if (provider.api_key) return { text: t('aiProvider.providers.keyPending'), last4: null }
  const stored = setting.value?.providers[provider.id]
  return stored?.key.configured && stored.preset === provider.preset ? { text: t('aiProvider.providers.keyConfigured'), last4: stored.key.last4 } : { text: t('aiProvider.providers.keyNone'), last4: null }
}
const cellValue = (quality: AiQuality, capability: AiCapability) => draft.routes.cells[cellKey(quality, capability)] || INHERIT
const setCell = (quality: AiQuality, capability: AiCapability, value: string) => { draft.routes.cells[cellKey(quality, capability)] = value === INHERIT ? '' : value }
const inheritedName = (quality: AiQuality, capability: AiCapability) => { const name = effectiveModel(draft.routes, quality, capability); return name ? ltr(name) : t('aiProvider.routes.none') }
const failure = (section: Section) => (failures.value[section] ? t(failures.value[section]!) : undefined)
const blockerKey = computed(() => (blockers.value[0] ? `aiProvider.save.blockers.${blockers.value[0]}` : null))
// The error summary: each blocker is a link to the field that fixes it; blockers that point at the same field share one line.
const rowField = (prefix: string, found?: ProviderDraft) => (found ? `${prefix}-${found.id}` : 'providers')
function blockerField(blocker: Blocker): string {
  if (blocker === 'providerEndpoint') return rowField('baseUrl', draft.providers.find(p => presetOf(p.preset)?.needs_base_url && !p.base_url.trim()))
  if (blocker === 'providerKey') {
    const needing = draft.providers.filter(p => presetOf(p.preset)?.needs_api_key && !p.api_key.trim())
    return rowField('apiKey', needing.find(p => !keyState(p).last4) ?? needing[0])
  }
  if (blocker === 'providerId') return rowField('provider', draft.providers.find(p => idProblem(providerIds.value, p.id)))
  if (blocker === 'noProviders') return 'addPreset'
  return blocker === 'margin' ? 'margin' : 'models'
}
const summaryErrors = computed(() => {
  if (!attempted.value) return []
  const lines = new Map<string, string>()
  for (const blocker of blockers.value) {
    const field = blockerField(blocker); const message = t(`aiProvider.save.blockers.${blocker}`)
    lines.set(field, lines.has(field) ? `${lines.get(field)} ${message}` : message)
  }
  return [...lines].map(([field, message]) => ({ field, message }))
})
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('aiProvider.title')" :description="t('aiProvider.intro')" />
    <SharedPageState :loading="pending && !data" :error="error" :empty="!pending && !error && !data" @retry="refresh">

    <!-- Outside every card form: its links reach fields of any card (the summary looks inside its own form first). -->
    <SharedErrorSummary ref="summary" :title="t('aiProvider.save.errorSummary')" :errors="summaryErrors" />
    <!-- The live region stays mounted so the result is announced when it appears. -->
    <div role="status" aria-live="polite" aria-atomic="true">
      <UAlert v-if="notice" color="success" variant="subtle" icon="i-lucide-check" :title="notice" data-testid="ai-provider-notice" />
    </div>
    <UAlert v-if="failure('general')" role="alert" color="error" variant="subtle" :title="failure('general')" data-testid="ai-provider-error" />

    <SharedSettingsCard id="status" :can-edit="canEdit" :title="t('aiProvider.status.title')">
      <p v-if="!setting" class="text-sm text-muted" data-testid="ai-provider-none">{{ t('aiProvider.status.none') }}</p>
      <template v-else>
        <UAlert
          :color="setting.delivery === 'delivered' ? 'success' : 'warning'" variant="subtle" :icon="setting.delivery === 'delivered' ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
          :title="t(`aiProvider.status.delivery.${setting.delivery}`, { revision: ltr(setting.revision) })"
          :description="setting.delivery === 'pending' ? t('aiProvider.status.pendingNote') : undefined" data-testid="ai-provider-delivery"
        />
        <template v-if="setting.delivery === 'pending'">
          <div v-if="!redelivering" class="flex flex-wrap items-center justify-between gap-2">
            <p v-if="dirty" class="text-xs text-muted" data-testid="ai-provider-redeliver-dirty">{{ t('aiProvider.redeliver.dirtyHint') }}</p>
            <span v-else />
            <UButton type="button" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :disabled="disabled || dirty" data-testid="ai-provider-redeliver" @click="redelivering = true">{{ t('aiProvider.redeliver.button') }}</UButton>
          </div>
          <SharedInlineConfirm
            v-else :title="t('aiProvider.redeliver.confirmTitle')" :description="t('aiProvider.redeliver.confirmDescription', { revision: ltr(setting.revision) })" :confirm-label="t('aiProvider.redeliver.confirm')"
            :pending="busy === 'redeliver'" :disabled="!redeliverReasonValid || dirty" color="warning" @confirm="redeliver" @cancel="cancelRedeliver"
          >
            <SharedFormField class="mt-3" name="redeliverReason" :label="t('aiProvider.redeliver.reason')" :help="t('aiProvider.save.reasonHint')" required>
              <UInput v-model="redeliverReason" maxlength="1000" class="w-full" :disabled="!hydrated || busy === 'redeliver'" data-testid="ai-provider-redeliver-reason" />
            </SharedFormField>
          </SharedInlineConfirm>
        </template>
        <p class="text-xs text-muted">{{ t('aiProvider.status.updated', { date: ltr(formatBusinessDateTime(setting.updated_at)) }) }}</p>
      </template>
    </SharedSettingsCard>

    <SharedSettingsCard id="providers" :can-edit="canEdit" :title="t('aiProvider.providers.title')" :description="t('aiProvider.providers.description')">
      <div data-field="providers">
      <SharedEmptyState v-if="!draft.providers.length" :title="t('aiProvider.providers.empty')" />
      <div v-for="provider in draft.providers" :key="provider.id" class="mb-3 space-y-3 rounded-card border border-default p-4" :data-field="`provider-${provider.id}`" data-testid="ai-provider-row">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="font-medium text-highlighted"><bdi dir="ltr">{{ provider.id }}</bdi> <span class="text-sm font-normal text-muted">{{ presetLabel(provider.preset) }}</span></p>
          <p class="text-sm text-muted" data-testid="ai-provider-key-state">{{ t('aiProvider.providers.key') }}: {{ keyState(provider).text }} <bdi v-if="keyState(provider).last4" dir="ltr">••••{{ keyState(provider).last4 }}</bdi></p>
        </div>
        <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
          <SharedFormField v-if="presetOf(provider.preset)?.needs_base_url" :name="`baseUrl-${provider.id}`" :label="t('aiProvider.providers.baseUrl')" :help="t(presetOf(provider.preset)?.provider === 'ollama' ? 'aiProvider.providers.baseUrlHintPrivate' : 'aiProvider.providers.baseUrlHintPublic')" required>
            <UInput v-model="provider.base_url" dir="ltr" type="url" maxlength="512" autocomplete="off" class="w-full" :disabled="disabled" />
          </SharedFormField>
          <SharedFormField v-if="presetOf(provider.preset)?.needs_api_key" :name="`apiKey-${provider.id}`" :label="t('aiProvider.providers.apiKey')" :help="t('aiProvider.providers.apiKeyHint')">
            <UInput v-model="provider.api_key" dir="ltr" type="password" maxlength="512" autocomplete="new-password" class="w-full" :disabled="disabled" data-testid="ai-provider-key" />
          </SharedFormField>
        </div>
        <UCheckbox v-if="presetOf(provider.preset)?.stream_usage_editable" v-model="provider.stream_usage" :label="t('aiProvider.providers.streamUsage')" :description="t('aiProvider.providers.streamUsageHint')" :disabled="disabled" />
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p v-if="!providerSaved(setting, provider, presets)" class="text-xs text-muted" data-testid="ai-provider-save-first">{{ t('aiProvider.providers.saveFirst') }}</p>
          <p v-else-if="loadedModels[provider.id]" class="text-xs text-muted">{{ t('aiProvider.providers.modelsLoaded', { count: ltr(loadedModels[provider.id]!.length) }) }}</p>
          <span v-else />
          <div class="flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="outline" icon="i-lucide-list-restart" :loading="busy === `models:${provider.id}`" :disabled="disabled || !providerSaved(setting, provider, presets)" data-testid="ai-provider-load" @click="loadModels(provider)">{{ t('aiProvider.providers.loadModels') }}</UButton>
          <UButton type="button" color="error" variant="ghost" icon="i-lucide-trash-2" :disabled="disabled || modelsOfProvider(draft, provider.id).length > 0" @click="removeProvider(provider)">{{ t('aiProvider.providers.remove') }}</UButton>
          </div>
        </div>
        <p v-if="modelsOfProvider(draft, provider.id).length" class="text-xs text-warning" data-testid="ai-provider-remove-blocked">{{ t('aiProvider.providers.removeBlocked', { models: ltr(modelsOfProvider(draft, provider.id).join(', ')) }) }}</p>
      </div>
      </div>
      <div class="mt-4 flex flex-wrap items-start gap-3 border-t border-default pt-4">
        <SharedFormField class="min-w-48 flex-1" name="addPreset" :label="t('aiProvider.providers.preset')">
          <USelect v-model="addPreset" :items="presetItems" :placeholder="t('aiProvider.providers.presetPlaceholder')" class="w-full" :disabled="disabled" data-testid="ai-provider-preset" />
        </SharedFormField>
        <SharedFormField class="min-w-48 flex-1" name="addProviderId" :label="t('aiProvider.providers.id')" :help="t('aiProvider.providers.idHint')" :error="addProviderProblem ? t(`aiProvider.idProblem.${addProviderProblem}`) : undefined">
          <UInput v-model="addProviderId" dir="ltr" maxlength="32" class="w-full" :disabled="disabled" />
        </SharedFormField>
        <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" class="sm:mt-6" :disabled="disabled || !addPreset || Boolean(addProviderProblem)" data-testid="ai-provider-add" @click="addProvider">{{ t('aiProvider.providers.add') }}</UButton>
      </div>
      <p v-if="failure('providers')" class="text-sm text-error" role="alert" data-testid="ai-provider-providers-error">{{ failure('providers') }}</p>
    </SharedSettingsCard>

    <aside id="ai-provider-steps" class="max-w-3xl space-y-2 rounded-card border border-default p-4" :aria-label="t('aiProvider.steps.title')" data-testid="ai-provider-steps">
      <p class="font-medium text-highlighted">{{ t('aiProvider.steps.title') }}</p>
      <ol class="list-decimal space-y-1 ps-5 text-sm text-muted">
        <li>{{ t('aiProvider.steps.save') }}</li>
        <li>{{ t('aiProvider.steps.test') }}</li>
        <li>{{ t('aiProvider.steps.route') }}</li>
      </ol>
    </aside>

    <SharedSettingsCard id="models" :can-edit="canEdit" :title="t('aiProvider.models.title')" :description="t('aiProvider.models.description')">
      <div data-field="models">
      <SharedDataTable v-if="draft.models.length" :rows="draft.models" :columns="columns" row-key="id" :caption="t('aiProvider.models.title')" density="comfortable">
                <template #provider-cell="{ row: { original: model } }">
          <USelect v-model="model.provider" :items="providerItems" class="w-40 max-w-full" :disabled="disabled" :aria-label="t('aiProvider.models.provider')" />
        </template>
        <template #model-cell="{ row: { original: model } }">
          <UInput v-model="model.model" dir="ltr" maxlength="128" autocomplete="off" class="w-56 max-w-full" :list="`models-${model.provider}`" :disabled="disabled" :aria-label="t('aiProvider.models.name')" data-testid="ai-model-name" />
        </template>
        <template v-for="field in priceFields" :key="field" #[`${field}-cell`]="{ row: { original: model } }">
          <UInput v-model="model[field]" dir="ltr" inputmode="decimal" class="w-28 max-w-full" :color="priceValid(model[field]) ? undefined : 'error'" :aria-invalid="!priceValid(model[field])" :aria-label="t(`aiProvider.models.${field}`)" :disabled="disabled" :data-testid="`ai-model-${field}`" />
          <p v-if="!priceValid(model[field])" class="mt-1 text-xs text-error">{{ t('aiProvider.models.priceInvalid') }}</p>
        </template>
        <template #id-cell="{ row: { original: model } }">
          <div class="w-40 whitespace-normal text-xs">
          <bdi class="block text-start text-sm font-medium text-highlighted" dir="ltr">{{ model.id }}</bdi>
          <p v-if="modelUsable(setting, model)" class="font-medium text-success" data-testid="ai-model-usable">{{ t('aiProvider.models.usable') }}</p>
          <p v-else class="font-medium text-warning" data-testid="ai-model-unusable">{{ t('aiProvider.models.unusable') }}<br>{{ t(`aiProvider.models.reason.${unusableReason(setting, model) ?? 'unpriced'}`) }}</p>
          <p v-if="!modelSaved(setting, model)" class="mt-1 text-xs text-muted" data-testid="ai-model-save-first">{{ t('aiProvider.models.saveFirst') }}</p>
          <p v-else class="mt-1 text-xs text-muted">{{ t('aiProvider.models.stored', { state: t(setting?.models[model.id]?.usage_reported ? 'aiProvider.models.reported' : 'aiProvider.models.notReported') }) }}</p>
          <div role="status" aria-live="polite" aria-atomic="true">
            <p v-if="testViews[model.id]?.ok" class="mt-1 text-sm" :class="testViews[model.id]!.usage ? 'text-success' : 'text-warning'" data-testid="ai-model-test-result">
              {{ t(testViews[model.id]!.usage ? 'aiProvider.models.testReported' : 'aiProvider.models.testNotReported', { ms: ltr(testViews[model.id]!.ms) }) }}
            </p>
          </div>
          <p v-if="testViews[model.id] && !testViews[model.id]!.ok" class="mt-1 text-sm text-error" role="alert" data-testid="ai-model-test-result">{{ t('aiProvider.models.testFailed') }}: {{ t(`aiProvider.test.${testViews[model.id]!.code}`) }}</p>
          </div>
        </template>
        <template #actions-cell="{ row: { original: model } }">
          <div class="flex items-center gap-1">
            <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plug-zap" :loading="busy === `test:${model.id}`" :disabled="disabled || !modelSaved(setting, model) || !providerReady(model.provider)" data-testid="ai-model-test" @click="testModel(model)">{{ t('aiProvider.models.test') }}</UButton>
            <UButton type="button" color="error" variant="ghost" icon="i-lucide-trash-2" :label="t('aiProvider.models.remove')" :aria-label="`${t('aiProvider.models.remove')} ${ltr(model.id)}`" :disabled="disabled" @click="removeModel(model)" />
          </div>
        </template>
      </SharedDataTable>
      <SharedEmptyState v-else :title="t('aiProvider.models.empty')" />
      </div>
      <p class="text-xs text-muted">{{ t('aiProvider.models.nameHint') }} {{ t('aiProvider.models.priceUnit') }}</p>
      <datalist v-for="provider in draft.providers" :id="`models-${provider.id}`" :key="provider.id"><option v-for="name in loadedModels[provider.id] ?? []" :key="name" :value="name" /></datalist>
      <p v-if="failure('models')" class="text-sm text-error" role="alert" data-testid="ai-provider-models-error">{{ failure('models') }}</p>
      <div class="mt-4 flex flex-wrap items-start gap-3 border-t border-default pt-4">
        <SharedFormField class="min-w-48 flex-1" name="addModelId" :label="t('aiProvider.models.id')" :help="t('aiProvider.providers.idHint')" :error="addModelProblem ? t(`aiProvider.idProblem.${addModelProblem}`) : undefined">
          <UInput v-model="addModelId" dir="ltr" maxlength="32" class="w-full" :disabled="disabled" />
        </SharedFormField>
        <SharedFormField class="min-w-48 flex-1" name="addModelProvider" :label="t('aiProvider.models.provider')">
          <USelect v-model="addModelProvider" :items="providerItems" :placeholder="t('aiProvider.models.providerPlaceholder')" class="w-full" :disabled="disabled" />
        </SharedFormField>
        <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" class="sm:mt-6" :disabled="disabled || !addModelId.trim() || !addModelProvider || Boolean(addModelProblem)" data-testid="ai-model-add" @click="addModel">{{ t('aiProvider.models.add') }}</UButton>
      </div>
    </SharedSettingsCard>

    <SharedSettingsCard id="margin" :can-edit="canEdit" :title="t('aiProvider.margin.title')" :description="t('aiProvider.margin.description')">
      <SharedFormField class="max-w-xs" name="margin" :label="t('aiProvider.margin.label')" :error="margin === null ? t('aiProvider.margin.invalid') : undefined" :submitted="attempted">
        <div class="flex items-center gap-2">
          <UInput v-model="draft.margin_percent" dir="ltr" inputmode="decimal" class="min-w-0 flex-1" :disabled="disabled" data-testid="ai-provider-margin" />
          <span class="shrink-0 text-sm text-muted" aria-hidden="true">%</span>
        </div>
      </SharedFormField>
      <p v-if="margin !== null" class="text-sm text-muted" data-testid="ai-provider-margin-example">{{ t('aiProvider.margin.example', { charge: ltr(chargeForOneDollar(margin)), cost: ltr('1.00') }) }}</p>
    </SharedSettingsCard>

    <SharedSettingsCard id="routes" :can-edit="canEdit" :title="t('aiProvider.routes.title')" :description="t('aiProvider.routes.description')">
      <SharedFormField class="max-w-sm" name="defaultModel" :label="t('aiProvider.routes.default')" :help="t('aiProvider.routes.defaultHint')" required>
        <USelect :model-value="draft.routes.default || undefined" :items="modelOptions(draft.routes.default)" :placeholder="t('aiProvider.routes.defaultPlaceholder')" class="w-full" :disabled="disabled" data-testid="ai-provider-default" @update:model-value="draft.routes.default = $event as string" />
      </SharedFormField>
      <UAlert v-if="unpricedRouted.length" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('aiProvider.routes.unpricedTitle')" :description="t('aiProvider.routes.unpricedWarning', { models: ltr(unpricedRouted.join(', ')) })" data-testid="ai-provider-unpriced-warning" />
      <UAlert v-if="quickUnmapped(draft.routes)" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('aiProvider.routes.quickWarningTitle')" :description="t('aiProvider.routes.quickWarning')" data-testid="ai-provider-quick-warning" />
      <div class="space-y-4">
        <div v-for="capability in AI_CAPABILITIES" :key="capability" class="space-y-2">
          <p class="text-sm font-medium text-highlighted">{{ t(`aiProvider.routes.capability.${capability}`) }}</p>
          <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
            <SharedFormField v-for="quality in AI_QUALITY_LEVELS" :key="quality" :name="`route-${quality}-${capability}`" :label="t(`aiProvider.routes.quality.${quality}`)">
              <USelect :model-value="cellValue(quality, capability)" :items="cellOptions(draft.routes.cells[cellKey(quality, capability)])" class="w-full" :disabled="disabled" :data-testid="`ai-route-${quality}-${capability}`" @update:model-value="setCell(quality, capability, $event as string)" />
              <p v-if="!draft.routes.cells[cellKey(quality, capability)]" class="mt-1 text-xs text-muted">{{ t('aiProvider.routes.inheritsFrom', { model: inheritedName(quality, capability) }) }}</p>
            </SharedFormField>
          </div>
        </div>
      </div>
      <p v-if="failure('routes')" class="text-sm text-error" role="alert" data-testid="ai-provider-routes-error">
        {{ failure('routes') }}
        <a v-if="aiProviderErrorHasSteps(failures.routes)" href="#ai-provider-steps" class="underline" data-testid="ai-provider-steps-link">{{ t('aiProvider.steps.link') }}</a>
      </p>
    </SharedSettingsCard>

    <SharedSettingsCard
      id="save" :can-edit="canEdit" :title="t('aiProvider.save.title')" :save-label="t('aiProvider.save.button')"
      :dirty="dirty" :saving="busy === 'save'" :on-save="startSave" @revert="revertDraft"
    >
      <p v-if="blockerKey" class="text-sm text-muted" data-testid="ai-provider-blocker">{{ t(blockerKey) }}</p>
      <p v-if="!draft.routes.default" class="text-sm text-muted">{{ t('aiProvider.save.incompleteNote') }}</p>
      <SharedInlineConfirm
        v-if="confirming" :title="t('aiProvider.save.confirmTitle')" :description="t('aiProvider.save.confirmDescription')" :confirm-label="t('aiProvider.save.confirm')"
        :pending="busy === 'save'" :disabled="!reasonValid || blockers.length > 0" color="warning" @confirm="save" @cancel="confirming = false"
      >
        <SharedFormField class="mt-3" name="reason" :label="t('aiProvider.save.reason')" :help="t('aiProvider.save.reasonHint')" required>
          <UInput v-model="reason" maxlength="1000" class="w-full" :disabled="!hydrated || busy === 'save'" data-testid="ai-provider-reason" />
        </SharedFormField>
      </SharedInlineConfirm>
    </SharedSettingsCard>
  </SharedPageState>
  </SharedSettingsPage>
</template>
