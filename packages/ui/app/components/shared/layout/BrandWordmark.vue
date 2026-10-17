<script setup lang="ts">
// WebVue logo: the approved mark (2026-10-17) followed by the product name; `markOnly` keeps the mark alone.
const props = withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg', inverted?: boolean, markOnly?: boolean }>(), { size: 'md', inverted: false, markOnly: false })
const { t } = useI18n()
const text = { sm: 'text-sm', md: 'text-base', lg: 'text-xl' } as const
const mark = { sm: 'h-4', md: 'h-5', lg: 'h-7' } as const
</script>

<template>
  <span class="inline-flex items-center gap-2 font-semibold" :class="[text[props.size], props.inverted ? 'text-white' : 'text-highlighted']">
    <svg data-slot="mark" viewBox="39 96 250 140" aria-hidden="true" fill="currentColor" class="w-auto shrink-0" :class="[mark[props.size], props.inverted ? 'text-white' : 'text-primary']">
      <path d="M39 101.532C73.6926 90.3914 94.9906 101.589 109.049 138.023C120.9 168.731 138.038 196.684 153.021 226.238C115.587 238.873 107.696 235.616 89.8 200.835C73.1538 168.45 56.6204 135.974 39 101.532Z" />
      <path d="M223.067 227.53C188.518 238.311 167.665 227.961 153.782 192.36C141.515 160.896 123.885 132.262 108.345 101.829C152.3 91.106 153.738 91.8507 174.704 133.034C190.37 163.774 206.151 194.468 223.067 227.53Z" />
      <path d="M234.1 208.332C222.152 184.837 211.533 166.281 202.962 146.526C192.29 121.915 202.643 102.203 226.181 99.8273C229.489 99.4945 232.837 99.7046 236.167 99.7046H289L234.1 208.332Z" />
    </svg>
    <template v-if="!props.markOnly">{{ t('brand.name') }}</template>
  </span>
</template>
