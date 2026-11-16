<script setup lang="ts">
import type { SalesPresetKey, SalesSettings, SalesSettingsPreset } from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { ApiError } from '@/composables/useApi'
import { SALES_PRESET_LABEL_KEYS, salesPresetChanges, salesPresetValueLabel } from '@/composables/sales/salesPresetPreview'
import { useApplySalesPreset } from '@/composables/sales/useSalesPresets'

// Sector presets: a few named bundles that set several of the settings above at once. Choosing one lists what it would
// change, setting by setting, and nothing is written until the manager confirms. Applying is an ordinary settings write,
// so a stale page is refused (409) and the card asks the manager to reload the current values first.
const props = defineProps<{ settings: SalesSettings; presets: SalesSettingsPreset[]; canEdit: boolean; reloadSettings: () => Promise<SalesSettings>; reloadPresets: () => Promise<unknown> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: apply, isPending: saving } = useApplySalesPreset()
const selected = ref<SalesPresetKey | null>(null)
const confirming = ref(false)
const conflict = ref(false)
const reloading = ref(false)
const reloadFailed = ref(false)
const error = ref<unknown>(null)

const preset = computed(() => props.presets.find(candidate => candidate.key === selected.value) ?? null)
const changes = computed(() => preset.value ? salesPresetChanges(preset.value, props.settings) : [])
const dirty = computed(() => changes.value.length > 0)
// A save that changed the settings under the choice leaves nothing to confirm.
watch(dirty, value => { if (!value) confirming.value = false })
const locked = computed(() => !hydrated.value || !props.canEdit || saving.value || reloading.value)
const options = computed(() => props.presets.map(item => ({
  value: item.key,
  label: item.matches ? `${t(`sales.settings.presets.${item.key}`)} (${t('sales.settings.presets.current')})` : t(`sales.settings.presets.${item.key}`),
  description: t(`sales.settings.presets.${item.key}Hint`),
})))
const message = computed(() => error.value ? saveErrorMessage(error.value, t('errors.generic'), t('errors.saveUncertain')) : '')

function revert() { selected.value = null; confirming.value = false; error.value = null }
async function reload() {
  reloading.value = true
  reloadFailed.value = false
  try {
    await Promise.all([props.reloadSettings(), props.reloadPresets()])
    conflict.value = false
    error.value = null
  } catch { reloadFailed.value = true } finally { reloading.value = false }
}
async function applyPreset() {
  if (!preset.value || locked.value) return
  error.value = null
  try {
    await apply({ preset: preset.value, settings: props.settings })
    selected.value = null
    confirming.value = false
  } catch (failure) {
    error.value = failure
    conflict.value = failure instanceof ApiError && failure.status === 409
    confirming.value = false
  }
}
</script>

<template>
  <SharedSettingsCard id="presets" :title="t('sales.settings.presets.title')" :description="t('sales.settings.presets.hint')" :can-edit="canEdit" :dirty="dirty" :saving="saving" :reloading="reloading" :conflict="conflict" :reload-failed="reloadFailed" :message="message" :save-label="t('sales.settings.presets.apply')" @save="confirming = true" @revert="revert" @reload="reload">
    <SharedOptionCards :model-value="selected ?? undefined" :options="options" :disabled="locked" :label="t('sales.settings.presets.title')" data-testid="sales-presets" @update:model-value="value => { selected = value as SalesPresetKey; confirming = false; error = null }" />
    <UAlert v-if="preset && !dirty" color="info" variant="subtle" icon="i-lucide-check" :title="t('sales.settings.presets.nothingToChange')" data-testid="sales-preset-same" />
    <div v-else-if="preset" class="grid gap-2" data-testid="sales-preset-preview">
      <p class="text-sm font-medium text-highlighted">{{ t('sales.settings.presets.preview', { count: changes.length }, changes.length) }}</p>
      <ul class="grid gap-2">
        <li v-for="change in changes" :key="change.key" class="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-default px-3 py-2 text-sm" :data-testid="`sales-preset-change-${change.key}`">
          <span class="min-w-0 text-highlighted">{{ t(SALES_PRESET_LABEL_KEYS[change.key]) }}</span>
          <span class="flex min-w-0 items-center gap-2">
            <span class="text-muted line-through">{{ salesPresetValueLabel(change.key, change.from, t) }}</span>
            <UIcon name="i-lucide-arrow-left" class="size-4 shrink-0 text-muted rtl:rotate-0 ltr:rotate-180" aria-hidden="true" />
            <span class="font-medium text-highlighted">{{ salesPresetValueLabel(change.key, change.to, t) }}</span>
          </span>
        </li>
      </ul>
    </div>
    <SharedInlineConfirm
      v-if="confirming && preset && dirty"
      color="warning"
      :title="t('sales.settings.presets.confirmTitle', { name: t(`sales.settings.presets.${preset.key}`) })"
      :description="t('sales.settings.presets.confirmBody')"
      :confirm-label="t('sales.settings.presets.apply')"
      :pending="saving"
      @cancel="confirming = false"
      @confirm="applyPreset"
    />
  </SharedSettingsCard>
</template>
