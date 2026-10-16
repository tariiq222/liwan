<script setup lang="ts">
import type { NuxtError } from '#app'
import { ar, en } from '@nuxt/ui/locale'
import { htmlAttrsFor } from '@/utils/htmlAttrs'

// Nuxt renders this file for unknown routes and uncaught errors, in the product's language and direction.
const props = defineProps<{ error: NuxtError }>()
const { t, locale, localeProperties } = useI18n()
useAppearanceHtmlClass()
const message = computed(() => t(props.error.statusCode === 404 ? 'app.error.notFound' : 'app.error.generic'))
useHead(() => ({
  title: `${message.value} · ${t('app.productName')}`,
  htmlAttrs: htmlAttrsFor({ lang: locale.value, dir: localeProperties.value.dir ?? 'rtl' }),
}))
</script>

<template>
  <UApp :locale="locale === 'ar' ? ar : en">
    <main class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-4 text-center">
      <p class="text-4xl font-semibold">
        {{ props.error.statusCode }}
      </p>
      <h1 class="text-lg">
        {{ message }}
      </h1>
      <UButton :label="t('app.error.home')" @click="clearError({ redirect: '/' })" />
    </main>
  </UApp>
</template>
