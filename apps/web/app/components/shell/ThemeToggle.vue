<script setup lang="ts">
import { useAppearance } from '@/composables/useAppearance'

// The moon/sun button of the top bar: one click flips light and dark, saved for the signed-in user.
const { t } = useI18n()
const hydrated = useHydrated()
const { mode, setMode } = useAppearance()
const dark = computed(() => mode.value === 'dark')
</script>

<template>
  <ShellToolButton
    data-testid="theme-toggle"
    variant="outline"
    :icon="dark ? 'i-lucide-sun' : 'i-lucide-moon'"
    :label="dark ? t('nav.theme.light') : t('nav.theme.dark')"
    :disabled="!hydrated"
    @click="setMode(dark ? 'light' : 'dark')"
  />
</template>
