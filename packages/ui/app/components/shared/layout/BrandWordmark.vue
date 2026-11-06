<script setup lang="ts">
// LiwanOS logo: the approved mark (a stroked courtyard of four pointed arches, one solid Sadu triangle in
// each corner pointing in, a stepped Sadu diamond at the centre) followed by the product name in the
// interface font; `markOnly` keeps the mark alone. Below 24px the mark takes a heavier stroke and a solid
// diamond so it stays legible; the name is the `brand.name` key of the active locale.
const props = withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg' | 'xl', inverted?: boolean, markOnly?: boolean }>(), { size: 'md', inverted: false, markOnly: false })
const { t } = useI18n()
const text = { sm: 'text-sm', md: 'text-base', lg: 'text-xl', xl: 'text-3xl' } as const
const mark = { sm: 'size-4', md: 'size-5', lg: 'size-7', xl: 'size-10' } as const
const heavy = computed(() => props.size === 'sm' || props.size === 'md')
// Sadu parts from packages/ui/app/assets/brand/sadu, laid on the mark's 64-unit grid.
const triangles = 'M15.74 8.67 18.92 18.92 8.67 15.74ZM55.33 15.74 45.08 18.92 48.26 8.67ZM48.26 55.33 45.08 45.08 55.33 48.26ZM8.67 48.26 18.92 45.08 15.74 55.33Z'
const diamondOutline = 'M30.5 24.5h3v3h-3ZM27.5 27.5h3v3h-3ZM33.5 27.5h3v3h-3ZM24.5 30.5h3v3h-3ZM30.5 30.5h3v3h-3ZM36.5 30.5h3v3h-3ZM27.5 33.5h3v3h-3ZM33.5 33.5h3v3h-3ZM30.5 36.5h3v3h-3Z'
const diamondSolid = 'M30.4 24h3.2v3.2h-3.2ZM27.2 27.2h3.2v3.2h-3.2ZM30.4 27.2h3.2v3.2h-3.2ZM33.6 27.2h3.2v3.2h-3.2ZM24 30.4h3.2v3.2h-3.2ZM27.2 30.4h3.2v3.2h-3.2ZM30.4 30.4h3.2v3.2h-3.2ZM33.6 30.4h3.2v3.2h-3.2ZM36.8 30.4h3.2v3.2h-3.2ZM27.2 33.6h3.2v3.2h-3.2ZM30.4 33.6h3.2v3.2h-3.2ZM33.6 33.6h3.2v3.2h-3.2ZM30.4 36.8h3.2v3.2h-3.2Z'
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
      <path :d="triangles" fill="currentColor" />
      <path :d="heavy ? diamondSolid : diamondOutline" fill="currentColor" />
    </svg>
    <template v-if="!props.markOnly">{{ t('brand.name') }}</template>
  </span>
</template>
