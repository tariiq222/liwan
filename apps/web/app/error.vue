<script setup lang="ts">
import type { NuxtError } from '#app'
import { ar, en } from '@nuxt/ui/locale'
import { createReusableTemplate } from '@vueuse/core'
import { htmlAttrsFor } from '@/utils/appearance'
import { firstAllowedPath } from '@/utils/accessPolicy'

// Nuxt renders this file instead of the app for unknown routes and uncaught
// errors. A signed-in user gets the error inside the shell layout (rail, header, sidebar);
// without an identity the shell cannot be built, so a standalone card is the fallback. Either
// way it keeps the product's language, direction and brand instead of Nuxt's English page.
const props = defineProps<{ error: NuxtError }>()
const { t, locale, localeProperties } = useI18n()
const { branding } = useBranding()
const { mode, fontSize } = useAppearance()

const status = computed(() => props.error.statusCode)
const forbidden = computed(() => status.value === 403)
const notFound = computed(() => status.value === 404)
const title = computed(() => t(forbidden.value ? 'errors.pageForbiddenTitle' : notFound.value ? 'errors.pageNotFoundTitle' : 'errors.pageErrorTitle'))
const description = computed(() => t(forbidden.value ? 'errors.forbidden' : notFound.value ? 'errors.pageNotFound' : 'errors.pageError'))
const hint = computed(() => (forbidden.value ? t('errors.pageForbidden') : undefined))
// Only an unexpected failure may pass on a second try; a missing or forbidden page stays the same.
const canRetry = computed(() => !forbidden.value && !notFound.value)
// A signed-in user keeps the rail, header and sidebar around the error; sign-in and outage errors have no identity to build them from.
const { me } = useMe()
const productName = computed(() => branding.value?.name ?? t('app.productName'))

useHead(() => ({
  title: `${title.value} · ${productName.value}`,
  htmlAttrs: htmlAttrsFor({ mode: mode.value, fontSize: fontSize.value, lang: locale.value, dir: localeProperties.value.dir ?? 'rtl' }),
}))

const icon = computed(() => (forbidden.value ? 'i-lucide-lock' : notFound.value ? 'i-lucide-search-x' : 'i-lucide-triangle-alert'))
const hydrated = useHydrated()
const canGoBack = computed(() => hydrated.value && window.history.length > 1)
// The same body in the shell and on the standalone card.
const [DefineBody, ReuseBody] = createReusableTemplate<{ heading: boolean }>()

function goHome() {
  // `/` resolves to the first section the user may open (pages/index.vue); a signed-in user goes there directly.
  void clearError({ redirect: me.value ? firstAllowedPath(me.value) : '/' })
}
function retry() {
  // A full reload of the same address, so the failed render and its data are requested again.
  reloadNuxtApp()
}
function goBack() {
  void clearError().then(() => window.history.back())
}
</script>

<template>
  <UApp :locale="locale === 'ar' ? ar : en">
    <DefineBody v-slot="{ heading }">
      <section class="mx-auto grid max-w-md justify-items-center gap-3 py-12 text-center" data-testid="app-error">
        <UIcon :name="icon" class="size-8 text-muted" aria-hidden="true" />
        <h1 v-if="heading" class="text-xl font-semibold text-highlighted">{{ title }}</h1>
        <p class="text-sm text-default">{{ description }}</p>
        <p v-if="hint" class="text-sm text-muted">{{ hint }}</p>
        <p class="text-xs text-muted">{{ t('errors.code', { code: '' }) }}<span dir="ltr">{{ status }}</span></p>
        <div class="mt-2 flex flex-wrap justify-center gap-2">
          <UButton v-if="canRetry" icon="i-lucide-rotate-cw" :label="t('app.retry')" :disabled="!hydrated" @click="retry" />
          <UButton icon="i-lucide-house" :color="canRetry ? 'neutral' : 'primary'" :variant="canRetry ? 'outline' : 'solid'" :label="t('errors.goHome')" @click="goHome" />
          <UButton v-if="canGoBack" color="neutral" variant="outline" :label="t('errors.goBack')" @click="goBack" />
        </div>
      </section>
    </DefineBody>
    <!-- A signed-in user keeps the rail, header and sidebar around the error. -->
    <NuxtLayout v-if="me" name="default">
      <ReuseBody :heading="true" />
    </NuxtLayout>
    <SharedStandalonePage v-else :title="title">
      <ReuseBody :heading="false" />
    </SharedStandalonePage>
  </UApp>
</template>
