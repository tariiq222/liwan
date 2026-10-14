<script setup lang="ts">
import type { NuxtError } from '#app'
import { ar, en } from '@nuxt/ui/locale'
import { htmlAttrsFor } from '@/utils/appearance'

// Nuxt renders this file instead of the app for unknown routes and uncaught
// errors, outside the shell layout (which needs a signed-in user). It keeps
// the product's language, direction and brand instead of Nuxt's English page.
const props = defineProps<{ error: NuxtError }>()
const { t, locale, localeProperties } = useI18n()
const { branding } = useBranding()
const { mode, fontSize } = useAppearance()

const notFound = computed(() => props.error.statusCode === 404)
const title = computed(() => t(notFound.value ? 'errors.pageNotFoundTitle' : 'errors.pageErrorTitle'))
const description = computed(() => t(notFound.value ? 'errors.pageNotFound' : 'errors.pageError'))
const productName = computed(() => branding.value?.name ?? t('app.productName'))

useHead(() => ({
  title: `${title.value} · ${productName.value}`,
  htmlAttrs: htmlAttrsFor({ mode: mode.value, fontSize: fontSize.value, lang: locale.value, dir: localeProperties.value.dir ?? 'rtl' }),
}))

function goHome() {
  // `/` resolves to the first section the user may open (pages/index.vue).
  void clearError({ redirect: '/' })
}
</script>

<template>
  <UApp :locale="locale === 'ar' ? ar : en">
    <SharedStandalonePage data-testid="app-error" :title="title">
      <div class="grid justify-items-center gap-4 text-center">
        <span class="text-sm font-semibold text-muted">{{ productName }}</span>
        <p class="font-mono text-5xl font-semibold text-highlighted" dir="ltr">{{ error.statusCode }}</p>
        <p class="text-sm text-muted">{{ description }}</p>
        <UButton icon="i-lucide-house" :label="t('errors.goHome')" @click="goHome" />
      </div>
    </SharedStandalonePage>
  </UApp>
</template>
