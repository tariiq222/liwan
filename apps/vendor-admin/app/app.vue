<script setup lang="ts">
import { ar, en } from '@nuxt/ui/locale'
import { htmlAttrsFor } from '@/utils/htmlAttrs'

const { locale } = useI18n()
// @nuxtjs/i18n only computes <html lang/dir>; applying them is left to the app.
const i18nHead = useLocaleHead({ seo: false })
useHead(() => ({
  htmlAttrs: htmlAttrsFor({ lang: i18nHead.value.htmlAttrs?.lang, dir: i18nHead.value.htmlAttrs?.dir }),
}))
</script>

<template>
  <UApp :locale="locale === 'ar' ? ar : en">
    <StepUpPanel />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
