<script setup lang="ts">
// LiwanOS logo: the approved mark (a stroked four-point star around a diamond) followed by the product
// name in the interface font; `markOnly` keeps the mark alone. Below 24px the mark takes the heavier
// stroke of liwan-mark-small.svg so it stays legible; the name is the `brand.name` key of the active locale.
const props = withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg', inverted?: boolean, markOnly?: boolean }>(), { size: 'md', inverted: false, markOnly: false })
const { t } = useI18n()
const text = { sm: 'text-sm', md: 'text-base', lg: 'text-xl' } as const
const mark = { sm: 'size-4', md: 'size-5', lg: 'size-7' } as const
const heavy = computed(() => props.size !== 'lg')
</script>

<template>
  <span class="inline-flex items-center gap-2 font-semibold" :class="[text[props.size], props.inverted ? 'text-white' : 'text-highlighted']">
    <svg
      data-slot="mark"
      :data-weight="heavy ? 'heavy' : 'regular'"
      :viewBox="heavy ? '-2 -2 68 68' : '0 0 64 64'"
      aria-hidden="true"
      class="shrink-0"
      :class="[mark[props.size], props.inverted ? 'text-white' : 'text-primary']"
    >
      <path
        d="M22.00 25.20Q25.50 25.50 25.20 22.00C24.60 16.00 24.20 13.20 26.50 10.50Q29.00 7.50 32.00 3.50Q35.00 7.50 37.50 10.50C39.80 13.20 39.40 16.00 38.80 22.00Q38.50 25.50 42.00 25.20C48.00 24.60 50.80 24.20 53.50 26.50Q56.50 29.00 60.50 32.00Q56.50 35.00 53.50 37.50C50.80 39.80 48.00 39.40 42.00 38.80Q38.50 38.50 38.80 42.00C39.40 48.00 39.80 50.80 37.50 53.50Q35.00 56.50 32.00 60.50Q29.00 56.50 26.50 53.50C24.20 50.80 24.60 48.00 25.20 42.00Q25.50 38.50 22.00 38.80C16.00 39.40 13.20 39.80 10.50 37.50Q7.50 35.00 3.50 32.00Q7.50 29.00 10.50 26.50C13.20 24.20 16.00 24.60 22.00 25.20Z"
        fill="none"
        stroke="currentColor"
        :stroke-width="heavy ? 7.5 : 4.6"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <rect
        :x="heavy ? 27.2 : 28.4"
        :y="heavy ? 27.2 : 28.4"
        :width="heavy ? 9.6 : 7.2"
        :height="heavy ? 9.6 : 7.2"
        rx=".8"
        transform="rotate(45 32 32)"
        fill="currentColor"
      />
    </svg>
    <template v-if="!props.markOnly">{{ t('brand.name') }}</template>
  </span>
</template>
