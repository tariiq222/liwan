<script setup lang="ts">
import { ar, en } from '@nuxt/ui/locale'
import { createBrandTheme } from '#nasq-utils/brandTheme'
import { useHydrated } from '#nasq-composables/useHydrated'

const { t, locale, localeCookie, setLocale, appearance, brand, secondary } = usePreview()
const hydrated = useHydrated()
if (localeCookie.value === 'en' && locale.value !== 'en') await setLocale('en')
const theme = computed(() => createBrandTheme(brand.value, appearance.value.mode, secondary.value))
useHead(() => ({ title: `${t('brand')} — ${t('reference')}`, meta: [{ name: 'description', content: t('demoNote') }], htmlAttrs: {
  lang: locale.value, dir: locale.value === 'ar' ? 'rtl' : 'ltr',
  class: appearance.value.mode, 'data-font-size': appearance.value.fontSize,
  style: Object.entries(theme.value).map(([key, value]) => `${key}:${value}`).join(';'),
} }))
</script>

<template>
  <UApp :locale="locale === 'ar' ? ar : en" :toaster="{ label: t('notifications') }">
    <!-- Native disabled inheritance prevents lost first clicks before hydration. -->
    <fieldset :disabled="!hydrated" class="contents" :aria-label="t('reference')">
      <PreviewShell><NuxtPage /></PreviewShell>
    </fieldset>
  </UApp>
</template>
