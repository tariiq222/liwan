<script setup lang="ts">
import type { Branding } from '@liwan/contracts'
import { DEFAULT_COMPANY_COLOR } from '@/utils/liwanPalette'
import { ApiError } from '@/composables/useApi'
import { buildBrandingPatch, normalizeHex } from '@/composables/colorHex'
import { useBrandingAdmin, useUpdateBranding } from '@/composables/useBrandingAdmin'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

const PRESETS = [
  { key: 'default', color: DEFAULT_COMPANY_COLOR, labelKey: 'settings.branding.presets.default' },
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
  read: branding => ({ primary_color: normalizeHex(branding.primary_color) ?? DEFAULT_COMPANY_COLOR }),
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
const swatchColor = computed(() => normalizeHex(draft.value.primary_color) ?? DEFAULT_COMPANY_COLOR)
const isSelected = (color: string) => normalizeHex(draft.value.primary_color) === normalizeHex(color)
</script>

<template>
  <SharedSettingsCard id="branding" v-bind="state" data-testid="branding-form" :title="t('settings.branding.color')" :description="t('settings.branding.managedIdentity')" :can-edit="editable" @save="save" @revert="revert" @reload="reload">
    <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
      <UFormField data-span="full" name="branding-color" :label="t('settings.branding.colorLabel')" :error="draft.primary_color && !primaryValid ? t('settings.branding.errors.invalidColor') : undefined">
        <div class="flex flex-wrap items-center gap-3">
          <UInput id="branding-color" v-model="draft.primary_color" data-testid="branding-color" dir="ltr" class="w-40 font-mono" :ui="{ leading: 'pointer-events-auto' }" :aria-invalid="!primaryValid" :disabled="locked">
            <template #leading>
              <UPopover>
                <button type="button" class="inline-grid rounded-inner focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) disabled:opacity-50" data-testid="branding-color-picker" :aria-label="t('settings.branding.colorPicker')" :disabled="locked">
                  <span class="size-5 rounded-inner border border-default" :style="{ backgroundColor: swatchColor }" aria-hidden="true" />
                </button>
                <template #content><UColorPicker v-model="draft.primary_color" class="p-3" /></template>
              </UPopover>
            </template>
          </UInput>
          <USeparator orientation="vertical" class="hidden h-(--liwan-control-h) sm:block" />
          <div class="flex flex-wrap items-center gap-1.5" role="group" :aria-label="t('settings.branding.presets.label')">
            <UTooltip v-for="preset in PRESETS" :key="preset.key" :text="t(preset.labelKey)">
              <button
                type="button"
                class="inline-grid size-8 place-items-center rounded-inner ring-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) disabled:opacity-50"
                :class="isSelected(preset.color) ? 'ring-[1.5px] ring-(--ring)' : 'hover:ring-1 hover:ring-(--ui-border-muted)'"
                data-testid="branding-preset"
                :aria-label="t(preset.labelKey)"
                :aria-pressed="isSelected(preset.color)"
                :disabled="locked"
                @click="draft.primary_color = preset.color"
              >
                <span class="inline-grid size-6 place-items-center rounded-inner border border-default text-white" :style="{ backgroundColor: preset.color }" aria-hidden="true">
                  <UIcon v-if="isSelected(preset.color)" name="i-lucide-check" class="size-3.5" />
                </span>
              </button>
            </UTooltip>
          </div>
        </div>
      </UFormField>
    </div>
  </SharedSettingsCard>
</template>
