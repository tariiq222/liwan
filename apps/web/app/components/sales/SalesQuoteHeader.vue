<script setup lang="ts">
// The head of the public quote page: the tenant's own logo and the company's name above the quotation's title, and none
// of LiwanOS's shell. The page draws it first inside its standalone page, which has no header slot in its document variant.
const props = defineProps<{ title: string; company: string | null }>()
const { t } = useI18n()
const { branding } = useBranding()
const company = computed(() => props.company ?? branding.value?.name ?? t('app.productName'))
</script>

<template>
  <header class="flex flex-col items-center text-center">
    <img v-if="branding?.logo_url" :src="branding.logo_url" :alt="company" class="mb-3 h-12 w-auto max-w-full object-contain" />
    <p class="text-sm text-muted" data-testid="quote-company">{{ company }}</p>
    <h1 class="mt-1 text-xl font-semibold text-highlighted" data-testid="quote-title">{{ props.title }}</h1>
  </header>
</template>
