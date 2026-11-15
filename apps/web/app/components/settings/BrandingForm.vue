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

// The four presets are one choice, so the group is a radiogroup: a colour that matches no preset (a typed hex) leaves every
// radio unchecked, which a radiogroup allows. Only one radio is in the tab order: the checked one, else the first.
const presetGroup = ref<HTMLElement | null>(null)
const tabbablePreset = computed(() => PRESETS.find(preset => isSelected(preset.color))?.key ?? PRESETS[0].key)
// Arrows move the choice by what the eye sees: ArrowRight goes toward the right edge, which is the previous radio in a
// right-to-left row. Up and Down follow the DOM order.
const ARROW_STEP: Record<string, 1 | -1> = { ArrowDown: 1, ArrowUp: -1 }
function onPresetKey(event: KeyboardEvent, index: number) {
  const rtl = presetGroup.value ? getComputedStyle(presetGroup.value).direction === 'rtl' : false
  const step = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : ARROW_STEP[event.key]
  if (!step) return
  event.preventDefault()
  const next = (index + step + PRESETS.length) % PRESETS.length
  draft.value.primary_color = PRESETS[next]!.color
  presetGroup.value?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
}
</script>

<template>
  <SharedSettingsCard id="branding" v-bind="state" data-testid="branding-form" :title="t('settings.branding.color')" :description="t('settings.branding.managedIdentity')" :can-edit="editable" @save="save" @revert="revert" @reload="reload">
    <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
      <UFormField data-span="full" name="branding-color" :label="t('settings.branding.colorLabel')" :error="draft.primary_color && !primaryValid ? t('settings.branding.errors.invalidColor') : undefined">
        <div class="flex flex-wrap items-center gap-3">
          <!-- The whole control is left-to-right as a unit: Nuxt UI pads the input on the logical start side and seats the leading slot there, so the swatch and the padding agree only when one direction owns both. -->
          <div dir="ltr" class="inline-flex">
            <UInput id="branding-color" v-model="draft.primary_color" data-testid="branding-color" class="w-40 font-mono" :ui="{ leading: 'pointer-events-auto' }" :aria-invalid="!primaryValid" :disabled="locked">
              <template #leading>
                <UPopover>
                  <button type="button" class="liwan-swatch-button inline-grid size-6 place-items-center rounded-inner focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) disabled:opacity-50" data-testid="branding-color-picker" :aria-label="t('settings.branding.colorPicker')" :disabled="locked">
                    <span class="size-5 rounded-inner border border-default" :style="{ backgroundColor: swatchColor }" aria-hidden="true" />
                  </button>
                  <template #content><UColorPicker v-model="draft.primary_color" class="p-3" /></template>
                </UPopover>
              </template>
            </UInput>
          </div>
          <USeparator orientation="vertical" class="hidden h-(--liwan-control-h) sm:block" />
          <div ref="presetGroup" class="liwan-swatch-group flex flex-wrap items-center" role="radiogroup" :aria-label="t('settings.branding.presets.label')">
            <button
              v-for="(preset, index) in PRESETS"
              :key="preset.key"
              type="button"
              role="radio"
              class="liwan-swatch-button inline-grid size-8 place-items-center rounded-inner ring-offset-2 ring-offset-(--ui-bg) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) disabled:opacity-50"
              :class="isSelected(preset.color) ? 'ring-[1.5px] ring-(--ring)' : 'hover:ring-1 hover:ring-(--ui-border-accented)'"
              data-testid="branding-preset"
              :aria-label="t(preset.labelKey)"
              :aria-checked="isSelected(preset.color)"
              :tabindex="preset.key === tabbablePreset ? 0 : -1"
              :disabled="locked"
              @click="draft.primary_color = preset.color"
              @keydown="onPresetKey($event, index)"
            >
              <!-- The tooltip sits on the decorative swatch, not on the button: Reka adds aria-describedby to its trigger while it is open, and here the text equals the button's name, so a screen reader would hear it twice. The outline uses the muted text colour because the border tokens are 1.5:1 to 1.8:1 against the card, too faint for the near-black default on a dark card. -->
              <UTooltip :text="t(preset.labelKey)">
                <span class="inline-grid size-6 place-items-center rounded-inner border border-(--ui-text-muted) text-white" :style="{ backgroundColor: preset.color }" aria-hidden="true">
                  <UIcon v-if="isSelected(preset.color)" name="i-lucide-check" class="size-3.5" />
                </span>
              </UTooltip>
            </button>
          </div>
        </div>
      </UFormField>
    </div>
  </SharedSettingsCard>
</template>
