<script setup lang="ts">
import type { NuxtError } from '#app'
import { ar, en } from '@nuxt/ui/locale'
import { htmlAttrsFor } from '@/utils/htmlAttrs'

// Nuxt renders this file for unknown routes and uncaught errors, in the product's language and direction.
const props = defineProps<{ error: NuxtError }>()
const { t, locale, localeProperties } = useI18n()
useAppearanceHtmlClass()
const MESSAGES: Record<number, string> = {
  403: 'app.error.forbidden',
  404: 'app.error.notFound',
  503: 'app.error.unavailable',
}
const status = computed(() => props.error.statusCode ?? 500)
const message = computed(() => t(MESSAGES[status.value] ?? 'app.error.generic'))
// "Back to home" would only come back here while the service is down, or for an account that holds no role at all;
// a refused page (an account without the capability) offers it, because the home page is open to every role.
const { can } = useVendorContextState()
const showHome = computed(() => status.value !== 503 && (status.value !== 403 || can('vendor.read')))
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
      <UButton v-if="showHome" :label="t('app.error.home')" @click="clearError({ redirect: '/' })" />
    </main>
  </UApp>
</template>
