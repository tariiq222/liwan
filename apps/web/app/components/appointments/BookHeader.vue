<script setup lang="ts">
// The head of the public booking page's card: the tenant's own logo and name above the page title, and none of LiwanOS's shell.
// It fills the `#header` slot of SharedStandalonePage, which the page uses as its shell.
defineProps<{ title: string }>()
const { t } = useI18n()
const { branding } = useBranding()
</script>

<template>
  <div class="flex flex-col items-center text-center">
    <img v-if="branding?.logo_url" :src="branding.logo_url" :alt="branding.name" class="mb-3 h-12 w-auto max-w-full object-contain" />
    <p class="text-sm text-muted" data-testid="book-brand">{{ branding?.name ?? t('app.productName') }}</p>
    <h1 class="mt-1 text-xl font-semibold text-highlighted">{{ title }}</h1>
  </div>
</template>
