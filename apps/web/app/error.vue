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
    <main class="grid min-h-dvh place-items-center bg-default px-4 py-12">
      <div class="grid w-full max-w-md justify-items-center gap-6 text-center" data-testid="app-error">
        <span class="text-sm font-semibold text-muted">{{ productName }}</span>
        <p class="font-mono text-5xl font-semibold text-highlighted" dir="ltr">{{ error.statusCode }}</p>
        <div class="grid gap-2">
          <h1 class="text-xl font-semibold text-highlighted">{{ title }}</h1>
          <p class="text-sm text-muted">{{ description }}</p>
        </div>
        <UButton icon="i-lucide-house" :label="t('errors.goHome')" @click="goHome" />
      </div>
    </main>
  </UApp>
</template>
