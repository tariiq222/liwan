<script setup lang="ts">
import { ar, en } from '@nuxt/ui/locale'
import ProjectRouteHost from '@/components/project/workspace/ProjectRouteHost.vue'

const { locale } = useI18n()
const { mode, fontSize } = useAppearance()
// @nuxtjs/i18n does not patch <html lang/dir> on its own — the module only
// computes the values via useLocaleHead(); applying them to the document
// head is left to the app (see the module's lang-switcher guide).
const i18nHead = useLocaleHead({ seo: false })
useHead(() => ({
  htmlAttrs: {
    class: mode.value === 'dark' ? 'dark' : mode.value === 'cream' ? 'cream' : '',
    'data-font-size': fontSize.value,
    lang: i18nHead.value.htmlAttrs?.lang,
    dir: i18nHead.value.htmlAttrs?.dir,
  },
}))
</script>

<template>
  <UApp :locale="locale === 'ar' ? ar : en">
    <NuxtLayout>
      <ProjectRouteHost />
    </NuxtLayout>
  </UApp>
</template>
