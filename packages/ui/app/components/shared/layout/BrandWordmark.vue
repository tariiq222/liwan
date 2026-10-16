<script setup lang="ts">
// Temporary WebVue wordmark until an SVG logo exists (spec 2026-10-11 §2).
const props = withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg', inverted?: boolean }>(), { size: 'md', inverted: false })
const { t } = useI18n()
const text = { sm: 'text-sm', md: 'text-base', lg: 'text-xl' } as const
const dot = { sm: 'size-1.5', md: 'size-2', lg: 'size-2.5' } as const
</script>

<template>
  <span class="inline-flex items-baseline gap-1 font-semibold" :class="[text[props.size], props.inverted ? 'text-white' : 'text-highlighted']">
    {{ t('brand.name') }}<span data-slot="dot" aria-hidden="true" class="inline-block rounded-full bg-webvue-lime" :class="dot[props.size]" />
  </span>
</template>
