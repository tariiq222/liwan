<script setup lang="ts">
import type { AppearanceMode, FontSize } from '@/utils/appearance'
const { t } = useI18n()
const { mode, fontSize, setMode, setFontSize } = useAppearance()
const hydrated = useHydrated()
const modes: AppearanceMode[] = ['light', 'cream', 'dark']
const sizes: FontSize[] = ['small', 'medium', 'large']
const icons = { light: 'i-lucide-sun', cream: 'i-lucide-coffee', dark: 'i-lucide-moon' }
</script>

<template>
  <SharedFormSection id="appearance-mode" panel class="rounded-lg ring ring-default bg-default overflow-hidden" :title="t('settings.appearance.mode')" :description="t('settings.appearance.modeHint')">
    <URadioGroup
      name="appearance-mode" :model-value="mode" :disabled="!hydrated" variant="card" orientation="horizontal" indicator="hidden"
      :items="modes.map(value => ({ value, label: t(`settings.appearance.${value}`), icon: icons[value] }))"
      :ui="{ fieldset: 'grid grid-cols-1 sm:grid-cols-3' }" @update:model-value="value => setMode(value as AppearanceMode)"
    >
      <template #label="{ item }"><span :data-testid="`appearance-mode-${item.value}`">{{ item.label }}</span></template>
    </URadioGroup>
  </SharedFormSection>
  <SharedFormSection id="appearance-font" panel class="rounded-lg ring ring-default bg-default overflow-hidden" :title="t('settings.appearance.fontSize')" :description="t('settings.appearance.fontHint')">
    <URadioGroup
      name="appearance-font" :model-value="fontSize" :disabled="!hydrated" variant="card" orientation="horizontal"
      :items="sizes.map(value => ({ value, label: t(`settings.appearance.${value}`), description: value === 'small' ? t('settings.appearance.default') : undefined }))"
      :ui="{ fieldset: 'grid grid-cols-1 sm:grid-cols-3' }" @update:model-value="value => setFontSize(value as FontSize)"
    >
      <template #label="{ item }"><span :data-testid="`appearance-font-${item.value}`">{{ item.label }}</span></template>
    </URadioGroup>
    <p class="mt-5 text-sm text-muted">{{ t('settings.appearance.savedHint') }}</p>
  </SharedFormSection>
</template>
