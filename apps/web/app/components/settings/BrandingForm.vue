<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createBrandTheme, derivedSecondary } from '@/utils/brandTheme'
import { ApiError } from '@/composables/useApi'
import { buildBrandingPatch, normalizeHex } from '@/composables/colorHex'
import { useBrandingAdmin, useUpdateBranding } from '@/composables/useBrandingAdmin'
import BrandingPreview from '@/components/settings/BrandingPreview.vue'

const DEFAULT_COLOR = '#18181b'
const PRESETS = [
  { key: 'default', color: DEFAULT_COLOR, labelKey: 'settings.branding.presets.default' },
  { key: 'blue', color: '#0055ff', labelKey: 'settings.branding.presets.blue' },
  { key: 'teal', color: '#0f766e', labelKey: 'settings.branding.presets.teal' },
  { key: 'amber', color: '#b45309', labelKey: 'settings.branding.presets.amber' },
] as const

const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const { data: branding, isLoading, error, refetch } = useBrandingAdmin()
const update = useUpdateBranding()

const color = ref(DEFAULT_COLOR)
const savedColor = ref(DEFAULT_COLOR)
const secondary = ref('')
const savedSecondary = ref('')
const dirty = ref(false)
const secondaryChanged = ref(false)
const validationError = ref('')

function luminance(hex: string) {
  const rgb = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!
}

function contrastRatio(first: string, second: string) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}

function loadSaved(value: { primary_color: string; secondary_color?: string | null }) {
  savedColor.value = normalizeHex(value.primary_color) ?? DEFAULT_COLOR
  savedSecondary.value = normalizeHex(value.secondary_color ?? '') ?? ''
  color.value = savedColor.value
  secondary.value = savedSecondary.value
  dirty.value = false
  secondaryChanged.value = false
}

watch(branding, (value) => {
  if (value && !dirty.value) loadSaved(value)
}, { immediate: true })

const previewName = computed(() => branding.value?.name ?? '')
const previewColor = computed(() => normalizeHex(color.value) ?? savedColor.value)
const previewSecondary = computed(() => normalizeHex(secondary.value) ?? undefined)
const previewLogo = computed(() => branding.value?.logo_url ?? '')
const isBusy = computed(() => update.isPending.value)
const primaryValid = computed(() => normalizeHex(color.value) !== null)
const secondaryValid = computed(() => !secondary.value.trim() || normalizeHex(secondary.value) !== null)
const colorValid = computed(() => primaryValid.value && secondaryValid.value)
const usageTheme = computed(() => {
  const primary = normalizeHex(color.value)
  return primary ? createBrandTheme(primary, 'light', previewSecondary.value) : null
})
const lowUsageContrast = computed(() => {
  const theme = usageTheme.value
  return !!theme && contrastRatio(theme['--primary-fill']!, theme['--primary-fill-foreground']!) < 4.5
})
const chartsNotDistinct = computed(() => {
  const theme = usageTheme.value
  if (!theme) return false
  return new Set([1, 2, 3, 4, 5, 6].map((index) => theme[`--chart-${index}`])).size < 6
})

function markDirty() {
  dirty.value = true
}

function markSecondary() {
  dirty.value = true
  secondaryChanged.value = true
}

function cancel() {
  validationError.value = ''
  color.value = savedColor.value
  secondary.value = savedSecondary.value
  dirty.value = false
  secondaryChanged.value = false
}

function resetDefault() {
  validationError.value = ''
  dirty.value = true
  secondaryChanged.value = true
  color.value = DEFAULT_COLOR
  secondary.value = ''
}

async function retryLoad() {
  await refetch()
}

async function save() {
  validationError.value = ''
  const patch = buildBrandingPatch({
    primaryColor: color.value,
    ...(secondaryChanged.value ? { secondaryColor: secondary.value.trim() ? secondary.value : null } : {}),
  })
  if (!patch) {
    validationError.value = t('settings.branding.errors.invalidColor')
    return
  }
  try {
    const saved = await update.mutateAsync(patch)
    loadSaved(saved)
    toast.add({ title: t('settings.branding.saved'), color: 'success' })
  } catch (error) {
    // Keep the colour draft after a transient save failure.
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  } finally {
    update.reset()
  }
}

onBeforeUnmount(() => update.reset())
</script>

<template>
  <div v-if="!hydrated || isLoading" role="status" aria-live="polite" aria-busy="true" :aria-label="t('settings.branding.loading')">
    <USkeleton class="h-80 w-full" />
  </div>
  <UAlert v-else-if="error" data-testid="branding-load-error" color="error" variant="subtle" :title="t('settings.branding.errors.load')">
    <template #actions>
      <UButton type="button" color="neutral" variant="outline" data-testid="branding-retry" :disabled="!hydrated" @click="retryLoad">{{ t('settings.branding.retry') }}</UButton>
    </template>
  </UAlert>
  <div v-else-if="branding" class="nasq-settings-branding">
    <form class="nasq-form space-y-5" data-testid="branding-form" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <p data-testid="branding-managed-identity" class="text-sm text-muted">
        {{ t('settings.branding.managedIdentity') }}
      </p>
      <div class="space-y-2">
        <label for="branding-color">{{ t('settings.branding.color') }}</label>
        <div class="flex items-center gap-2">
          <UInput id="branding-color" v-model="color" data-testid="branding-color" dir="ltr" class="min-w-0 flex-1 font-mono" :aria-invalid="!primaryValid" :disabled="!hydrated || isBusy" @update:model-value="markDirty" />
          <UPopover>
            <UButton type="button" color="neutral" variant="outline" square data-testid="branding-color-picker" :aria-label="t('settings.branding.colorPicker')" :disabled="!hydrated || isBusy">
              <span class="size-5 rounded border" :style="{ backgroundColor: previewColor }" />
            </UButton>
            <template #content><UColorPicker v-model="color" class="p-3" :disabled="isBusy" @update:model-value="markDirty" /></template>
          </UPopover>
        </div>
        <p class="text-sm text-muted">{{ t('settings.branding.primaryHint') }}</p>
        <p v-if="color && !primaryValid" role="alert" class="text-sm text-error">{{ t('settings.branding.errors.invalidColor') }}</p>
        <div class="flex flex-wrap gap-2" :aria-label="t('settings.branding.presets.label')">
          <UButton
            v-for="preset in PRESETS"
            :key="preset.key"
            type="button"
            color="neutral" variant="outline"
            data-testid="branding-preset"
            :aria-label="t(preset.labelKey)"
            :disabled="!hydrated || isBusy"
            @click="dirty = true; color = preset.color"
          >
            <span class="size-4 rounded-full border" :style="{ backgroundColor: preset.color }" aria-hidden="true" />
            {{ t(preset.labelKey) }}
          </UButton>
        </div>
      </div>
      <UFormField :label="t('settings.branding.secondaryColor')" name="secondary_color">
        <div class="flex items-center gap-2">
          <UInput id="branding-secondary-color" v-model="secondary" data-testid="branding-secondary-color" dir="ltr" class="flex-1" :aria-invalid="!secondaryValid" :disabled="!hydrated || isBusy" @update:model-value="markSecondary" />
          <UPopover>
            <UButton type="button" color="neutral" variant="outline" square :aria-label="t('settings.branding.secondaryColor')" :disabled="!hydrated || isBusy">
              <span class="size-5 rounded border" :style="{ backgroundColor: previewSecondary ?? 'transparent' }" />
            </UButton>
            <template #content><UColorPicker v-model="secondary" class="p-3" :disabled="isBusy" @update:model-value="markSecondary" /></template>
          </UPopover>
          <UButton
            type="button"
            color="neutral"
            variant="subtle"
            size="sm"
            data-testid="branding-suggest-secondary"
            :disabled="!hydrated || isBusy || !normalizeHex(color)"
            @click="markSecondary(); secondary = derivedSecondary(color)"
          >
            {{ t('settings.branding.suggestSecondary') }}
          </UButton>
        </div>
        <p class="text-sm text-muted">{{ t('settings.branding.secondaryHint') }}</p>
        <p v-if="secondary.trim() && !secondaryValid" role="alert" class="text-sm text-error">{{ t('settings.branding.errors.invalidColor') }}</p>
      </UFormField>
      <UAlert v-if="lowUsageContrast" color="warning" :title="t('settings.branding.usageContrast')" />
      <UAlert v-if="chartsNotDistinct" color="warning" :title="t('settings.branding.chartsNotDistinct')" />
      <p v-if="validationError" role="alert" class="text-sm text-error">{{ validationError }}</p>
      <div class="nasq-form-footer">
        <UButton type="submit" data-testid="branding-submit" :aria-invalid="!colorValid" :disabled="!hydrated || isBusy || !colorValid">
          {{ update.isPending.value ? t('settings.branding.saving') : t('settings.branding.save') }}
        </UButton>
        <UButton type="button" color="neutral" variant="outline" data-testid="branding-cancel" :disabled="!hydrated || isBusy" @click="cancel">
          {{ t('settings.branding.cancel') }}
        </UButton>
        <UButton type="button" color="neutral" variant="outline" data-testid="branding-default" :disabled="!hydrated || isBusy" @click="resetDefault">
          {{ t('settings.branding.resetDefault') }}
        </UButton>
      </div>
    </form>

    <BrandingPreview :name="previewName" :color="previewColor" :secondary-color="previewSecondary" :logo-url="previewLogo" />
  </div>
</template>
