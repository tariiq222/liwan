<script setup lang="ts">
import type { Branding } from '@liwan/contracts'
import { LIWAN_PRIMARY } from '@/utils/liwanPalette'
import { ApiError } from '@/composables/useApi'
import { buildBrandingPatch, normalizeHex } from '@/composables/colorHex'
import { useBrandingAdmin, useUpdateBranding } from '@/composables/useBrandingAdmin'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

const PRESETS = [
  { key: 'default', color: LIWAN_PRIMARY, labelKey: 'settings.branding.presets.default' },
  { key: 'blue', color: '#0055ff', labelKey: 'settings.branding.presets.blue' },
  { key: 'teal', color: '#0f766e', labelKey: 'settings.branding.presets.teal' },
  { key: 'amber', color: '#b45309', labelKey: 'settings.branding.presets.amber' },
] as const

const props = defineProps<{ branding: Branding }>()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const { can } = useAccess()
const update = useUpdateBranding()
const { refetch } = useBrandingAdmin()

const editable = computed(() => can('settings.branding.manage'))
const { draft, state, save, revert, reload } = useSettingsForm<Branding, { primary_color: string }>({
  source: () => props.branding,
  read: branding => ({ primary_color: normalizeHex(branding.primary_color) ?? LIWAN_PRIMARY }),
  save: async (values) => {
    const patch = buildBrandingPatch({ primaryColor: values.primary_color })
    if (!patch) throw new ApiError(422, 'invalid', t('settings.branding.errors.invalidColor'), 'primary_color')
    const saved = await update.mutateAsync(patch)
    toast.add({ title: t('settings.branding.saved'), color: 'success' })
    return saved
  },
  reload: async () => {
    const result = await refetch()
    if (result.isError) throw result.error
    return result.data ?? props.branding
  },
})

const locked = computed(() => !hydrated.value || !editable.value || state.value.saving || state.value.reloading)
const primaryValid = computed(() => normalizeHex(draft.value.primary_color) !== null)
const swatchColor = computed(() => normalizeHex(draft.value.primary_color) ?? LIWAN_PRIMARY)
</script>

<template>
  <SharedSettingsCard id="branding" v-bind="state" data-testid="branding-form" :title="t('settings.branding.color')" :description="t('settings.branding.managedIdentity')" :can-edit="editable" @save="save" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" name="branding-color" :label="t('settings.branding.color')" :description="t('settings.branding.primaryHint')" :error="draft.primary_color && !primaryValid ? t('settings.branding.errors.invalidColor') : undefined">
      <div class="flex items-center gap-2">
        <UInput id="branding-color" v-model="draft.primary_color" data-testid="branding-color" dir="ltr" class="min-w-0 flex-1 font-mono" :aria-invalid="!primaryValid" :disabled="locked" />
        <UPopover>
          <UButton type="button" color="neutral" variant="outline" square data-testid="branding-color-picker" :aria-label="t('settings.branding.colorPicker')" :disabled="locked">
            <span class="size-5 rounded border border-default" :style="{ backgroundColor: swatchColor }" />
          </UButton>
          <template #content><UColorPicker v-model="draft.primary_color" class="p-3" /></template>
        </UPopover>
      </div>
    </UFormField>
    <UFormField orientation="horizontal" :label="t('settings.branding.presets.label')">
      <div class="flex flex-wrap gap-2" role="group" :aria-label="t('settings.branding.presets.label')">
        <UButton
          v-for="preset in PRESETS"
          :key="preset.key"
          type="button"
          color="neutral" variant="outline"
          data-testid="branding-preset"
          :aria-label="t(preset.labelKey)"
          :disabled="locked"
          @click="draft.primary_color = preset.color"
        >
          <span class="size-4 rounded-full border border-default" :style="{ backgroundColor: preset.color }" aria-hidden="true" />
          {{ t(preset.labelKey) }}
        </UButton>
      </div>
    </UFormField>
  </SharedSettingsCard>
</template>
