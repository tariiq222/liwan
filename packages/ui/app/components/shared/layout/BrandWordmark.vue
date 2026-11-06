<script setup lang="ts">
// LiwanOS logo: the approved mark (a stroked courtyard of four pointed arches, one solid Sadu triangle in
// each corner pointing in, a stepped Sadu diamond at the centre) followed by the product name in the
// interface font; `markOnly` keeps the mark alone. Below 24px the mark takes a heavier stroke and a solid
// diamond so it stays legible; the name is the `brand.name` key of the active locale. `animated` (the login splash)
// draws the courtyard once and then shows the triangles and the diamond; under reduced motion it is drawn at once.
import { MARK_ARCHES, MARK_DIAMOND_OUTLINE, MARK_DIAMOND_SOLID, MARK_TRIANGLES } from '../../../utils/brandMark'

const props = withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg' | 'xl', inverted?: boolean, markOnly?: boolean, animated?: boolean }>(), { size: 'md', inverted: false, markOnly: false, animated: false })
const { t } = useI18n()
const text = { sm: 'text-sm', md: 'text-base', lg: 'text-xl', xl: 'text-3xl' } as const
const mark = { sm: 'size-4', md: 'size-5', lg: 'size-7', xl: 'size-10' } as const
const heavy = computed(() => props.size === 'sm' || props.size === 'md')
const triangles = MARK_TRIANGLES.join('')
</script>

<template>
  <span class="inline-flex items-center gap-2 font-semibold" :class="[text[props.size], props.inverted ? 'text-white' : 'text-highlighted']">
    <svg
      data-slot="mark"
      :data-animated="props.animated || undefined"
      :data-weight="heavy ? 'heavy' : 'regular'"
      :viewBox="heavy ? '-2 -2 68 68' : '0 0 64 64'"
      aria-hidden="true"
      class="shrink-0"
      :class="[mark[props.size], props.inverted ? 'text-white' : 'text-primary']"
    >
      <path
        :d="MARK_ARCHES"
        pathLength="1"
        :class="{ 'liwan-mark-draw': props.animated }"
        fill="none"
        stroke="currentColor"
        :stroke-width="heavy ? 7.5 : 4.6"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <g :class="{ 'liwan-mark-reveal': props.animated }">
        <path :d="triangles" fill="currentColor" />
        <path :d="heavy ? MARK_DIAMOND_SOLID : MARK_DIAMOND_OUTLINE" fill="currentColor" />
      </g>
    </svg>
    <template v-if="!props.markOnly">{{ t('brand.name') }}</template>
  </span>
</template>
