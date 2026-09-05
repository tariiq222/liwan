<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
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
const hydrated = useHydrated()
const { data: branding, isLoading, error, refetch } = useBrandingAdmin()
const update = useUpdateBranding()

const color = ref(DEFAULT_COLOR)
const savedColor = ref(DEFAULT_COLOR)
const dirty = ref(false)
const validationError = ref('')

function loadSaved(value: { primary_color: string }) {
  savedColor.value = normalizeHex(value.primary_color) ?? DEFAULT_COLOR
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
const colorValid = computed(() => normalizeHex(color.value) !== null)

function cancel() {
  validationError.value = ''
  color.value = savedColor.value
  dirty.value = false
}

function resetDefault() {
  validationError.value = ''
  dirty.value = true
  color.value = DEFAULT_COLOR
}

async function retryLoad() {
  await refetch()
}

async function save() {
  validationError.value = ''
  const patch = buildBrandingPatch({ primaryColor: color.value })
  if (!patch) {
    validationError.value = t('settings.branding.errors.invalidColor')
    return
  }
  try {
    const saved = await update.mutateAsync(patch)
    loadSaved(saved)
    toast.success(t('settings.branding.saved'))
  } catch (error) {
    // Keep the colour draft after a transient save failure.
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  } finally {
    update.reset()
  }
}

onBeforeUnmount(() => update.reset())
</script>

<template>
  <div v-if="isLoading" role="status" aria-live="polite" aria-busy="true" :aria-label="t('settings.branding.loading')">
    <Skeleton class="h-80 w-full" />
  </div>
  <div v-else-if="error" data-testid="branding-load-error" class="space-y-3 rounded-lg border border-destructive/50 p-6">
    <p role="alert" class="text-sm text-destructive">{{ t('settings.branding.errors.load') }}</p>
    <Button type="button" data-testid="branding-retry" :disabled="!hydrated" @click="retryLoad">
      {{ t('settings.branding.retry') }}
    </Button>
  </div>
  <div v-else-if="branding" class="grid gap-6 lg:grid-cols-2">
    <form class="space-y-5" data-testid="branding-form" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <p data-testid="branding-managed-identity" class="text-sm text-muted-foreground">
        {{ t('settings.branding.managedIdentity') }}
      </p>
      <div class="space-y-2">
        <Label for="branding-color">{{ t('settings.branding.color') }}</Label>
        <div class="flex items-center gap-2">
          <Input id="branding-color" v-model="color" data-testid="branding-color" dir="ltr" class="min-w-0 flex-1 font-mono" :aria-invalid="!colorValid" :disabled="!hydrated || isBusy" @update:model-value="dirty = true" />
          <input
            v-model="color"
            data-testid="branding-color-picker"
            type="color"
            :aria-label="t('settings.branding.colorPicker')"
            class="h-9 w-12 shrink-0 rounded border p-1"
            :disabled="!hydrated || isBusy"
            @input="dirty = true"
          >
        </div>
        <p v-if="color && !colorValid" role="alert" class="text-sm text-destructive">{{ t('settings.branding.errors.invalidColor') }}</p>
        <div class="flex flex-wrap gap-2" :aria-label="t('settings.branding.presets.label')">
          <Button
            v-for="preset in PRESETS"
            :key="preset.key"
            type="button"
            variant="outline"
            data-testid="branding-preset"
            :aria-label="t(preset.labelKey)"
            :disabled="!hydrated || isBusy"
            @click="dirty = true; color = preset.color"
          >
            <span class="size-4 rounded-full border" :style="{ backgroundColor: preset.color }" aria-hidden="true" />
            {{ t(preset.labelKey) }}
          </Button>
        </div>
      </div>
      <p v-if="validationError" role="alert" class="text-sm text-destructive">{{ validationError }}</p>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" data-testid="branding-submit" :aria-invalid="!colorValid" :disabled="!hydrated || isBusy || !colorValid">
          {{ update.isPending.value ? t('settings.branding.saving') : t('settings.branding.save') }}
        </Button>
        <Button type="button" variant="outline" data-testid="branding-cancel" :disabled="!hydrated || isBusy" @click="cancel">
          {{ t('settings.branding.cancel') }}
        </Button>
        <Button type="button" variant="ghost" data-testid="branding-default" :disabled="!hydrated || isBusy" @click="resetDefault">
          {{ t('settings.branding.resetDefault') }}
        </Button>
      </div>
    </form>

    <BrandingPreview :name="previewName" :color="previewColor" :logo-url="previewLogo" />
  </div>
</template>
