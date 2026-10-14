<script setup lang="ts">
import type { AppearanceMode, FontSize } from '@/utils/appearance'

// Display mode and font size live in the header and are saved per user on
// the server (see useAppearance); this menu is a control, not a screen.
const { t } = useI18n()
const { mode, fontSize, setMode, setFontSize } = useAppearance()
const hydrated = useHydrated()
const modes: AppearanceMode[] = ['light', 'dark']
const sizes: FontSize[] = ['small', 'medium', 'large']
const modeIcons: Record<AppearanceMode, string> = { light: 'i-lucide-sun', dark: 'i-lucide-moon' }

const items = computed(() => [
  [
    { type: 'label' as const, label: t('settings.appearance.mode') },
    ...modes.map(value => ({
      type: 'checkbox' as const,
      label: t(`settings.appearance.${value}`),
      icon: modeIcons[value],
      checked: mode.value === value,
      // Checkbox items toggle; the group behaves as a radio, so only a
      // newly checked entry changes the preference.
      onUpdateChecked: (checked: boolean) => { if (checked) setMode(value) },
    })),
  ],
  [
    { type: 'label' as const, label: t('settings.appearance.fontSize') },
    ...sizes.map(value => ({
      type: 'checkbox' as const,
      label: t(`settings.appearance.${value}`),
      checked: fontSize.value === value,
      onUpdateChecked: (checked: boolean) => { if (checked) setFontSize(value) },
    })),
  ],
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :modal="false"
    :disabled="!hydrated"
    :content="{ align: 'end', sideOffset: 4, avoidCollisions: false, sticky: 'always', updatePositionStrategy: 'always' }"
    :ui="{ content: 'approved-account-menu z-[80] min-w-48' }"
  >
    <UButton
      type="button"
      data-testid="appearance-menu"
      color="neutral"
      variant="ghost"
      square
      :icon="modeIcons[mode]"
      :disabled="!hydrated"
      :aria-label="`${t('settings.appearance.title')}: ${t(`settings.appearance.${mode}`)}، ${t(`settings.appearance.${fontSize}`)}`"
      :title="t('settings.appearance.title')"
    />
  </UDropdownMenu>
</template>
