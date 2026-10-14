<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createBrandTheme, DEFAULT_PRIMARY } from '@/utils/brandTheme'
import { ApiError } from '@/composables/useApi'
import { buildBrandingPatch, normalizeHex } from '@/composables/colorHex'
import { useBrandingAdmin, useUpdateBranding } from '@/composables/useBrandingAdmin'
import BrandingPreview from '@/components/settings/BrandingPreview.vue'

const PRESETS = [
  { key: 'default', color: DEFAULT_PRIMARY, labelKey: 'settings.branding.presets.default' },
  { key: 'blue', color: '#0055ff', labelKey: 'settings.branding.presets.blue' },
  { key: 'teal', color: '#0f766e', labelKey: 'settings.branding.presets.teal' },
  { key: 'amber', color: '#b45309', labelKey: 'settings.branding.presets.amber' },
] as const

const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const { data: branding, isLoading, error, refetch } = useBrandingAdmin()
const update = useUpdateBranding()

const color = ref(DEFAULT_PRIMARY)
const savedColor = ref(DEFAULT_PRIMARY)
const dirty = ref(false)
const validationError = ref('')

function loadSaved(value: { primary_color: string }) {
  savedColor.value = normalizeHex(value.primary_color) ?? DEFAULT_PRIMARY
  color.value = savedColor.value
  dirty.value = false
}

watch(branding, (value) => {
  if (value && !dirty.value) loadSaved(value)
}, { immediate: true })

const previewName = computed(() => branding.value?.name ?? '')
const previewColor = computed(() => normalizeHex(color.value) ?? savedColor.value)
const previewLogo = computed(() => branding.value?.logo_url ?? '')
const isBusy = computed(() => update.isPending.value)
const primaryValid = computed(() => normalizeHex(color.value) !== null)
const colorValid = computed(() => primaryValid.value)
const usageTheme = computed(() => {
  const primary = normalizeHex(color.value)
  return primary ? createBrandTheme(primary, 'light') : null
})
const chartsNotDistinct = computed(() => {
  const theme = usageTheme.value
  if (!theme) return false
  return new Set([1, 2, 3, 4, 5, 6].map((index) => theme[`--chart-${index}`])).size < 6
})

function markDirty() {
  dirty.value = true
}

function cancel() {
  validationError.value = ''
  color.value = savedColor.value
  dirty.value = false
}

function resetDefault() {
  validationError.value = ''
  dirty.value = true
  color.value = DEFAULT_PRIMARY
}

async function retryLoad() {
  await refetch()
}

async function save() {
  validationError.value = ''
  const patch = buildBrandingPatch({
    primaryColor: color.value,
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
  <SharedLoadingSkeleton v-if="!hydrated || isLoading" variant="rows" :count="4" />
  <UAlert v-else-if="error" data-testid="branding-load-error" color="error" variant="subtle" :title="t('settings.branding.errors.load')">
    <template #actions>
      <UButton type="button" color="neutral" variant="outline" data-testid="branding-retry" :disabled="!hydrated" @click="retryLoad">{{ t('settings.branding.retry') }}</UButton>
    </template>
  </UAlert>
  <div v-else-if="branding" class="nasq-settings-branding">
    <form class="nasq-form" data-testid="branding-form" @submit.prevent="save">
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
              <span class="size-5 rounded border border-default" :style="{ backgroundColor: previewColor }" />
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
            <span class="size-4 rounded-full border border-default" :style="{ backgroundColor: preset.color }" aria-hidden="true" />
            {{ t(preset.labelKey) }}
          </UButton>
        </div>
      </div>
      <UAlert v-if="chartsNotDistinct" color="warning" :title="t('settings.branding.chartsNotDistinct')" />
      <UAlert v-if="validationError" role="alert" color="error" variant="subtle" :title="validationError" />
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

    <BrandingPreview :name="previewName" :color="previewColor" :logo-url="previewLogo" />
  </div>
</template>
