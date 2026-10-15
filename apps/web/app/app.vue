<script setup lang="ts">
import { ar, en } from '@nuxt/ui/locale'
import { htmlAttrsFor } from '@/utils/appearance'
import { pageArea } from '@/utils/workspacePresentation'

// The layer frames pages by the classification the app gives each path (plain, project area, record).
providePageArea(pageArea)
const { locale } = useI18n()
const { mode, fontSize, syncFromUser } = useAppearance()
const { me } = useMe()
// Each signed-in user gets their own saved appearance; the cookie only
// carries the last applied one for the first server paint.
watch(me, syncFromUser, { immediate: true })
// @nuxtjs/i18n does not patch <html lang/dir> on its own — the module only
// computes the values via useLocaleHead(); applying them to the document
// head is left to the app (see the module's lang-switcher guide).
const i18nHead = useLocaleHead({ seo: false })
useHead(() => ({
  htmlAttrs: htmlAttrsFor({
    mode: mode.value,
    fontSize: fontSize.value,
    lang: i18nHead.value.htmlAttrs?.lang,
    dir: i18nHead.value.htmlAttrs?.dir,
  }),
}))
</script>

<template>
  <UApp :locale="locale === 'ar' ? ar : en">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
