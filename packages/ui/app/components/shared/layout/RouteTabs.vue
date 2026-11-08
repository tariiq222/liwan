<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { routeTabClass, routeTabCountClass, routeTabPillClass, routeTabSeparatorClass, routeTabsFrameClass, routeTabsFrameDividerClass, routeTabsPillStripClass, routeTabsStripClass } from '../../../utils/sectionTabs'

// Route-backed tabs (DESIGN.md §6): links in one strip that never wraps. The default `underline` variant draws one straight
// 2.5px underline in the application colour under the current item (the page header's views, record sections) over a 1px
// divider; an item with a `count` shows it in a small badge after the label; `pill` is the round pill strip of the
// sub-sections, the current item a primary-tinted pill. A strip wider than its place scrolls sideways, fades the edge that
// still has content behind it and brings the current tab into view on mount and when the route changes. The caller decides
// which item is active and names each by `key`, which is also its test id; `separatorBefore` draws a thin separator
// before an item (record tabs, then log tabs). A header that already ends in a divider passes `divider: false`.
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  items: { key: string; label: string; to: RouteLocationRaw; active: boolean; icon?: string; count?: number | string; separatorBefore?: boolean }[]
  ariaLabel: string
  variant?: 'underline' | 'pill'
  divider?: boolean
}>(), { variant: 'underline', divider: true })

const FADE_WIDTH = 28
const strip = ref<HTMLElement | null>(null)
// The faded sides are physical (left/right), so a right-to-left strip needs no special case in the CSS.
const fadeLeft = ref(0)
const fadeRight = ref(0)
const fadeStyle = computed(() => ({ '--tabs-fade-l': `${fadeLeft.value}px`, '--tabs-fade-r': `${fadeRight.value}px` }))
const activeKey = computed(() => props.items.find(item => item.active)?.key)

function syncFade() {
  const el = strip.value
  if (!el) return
  const room = el.scrollWidth - el.clientWidth
  if (room <= 1) {
    fadeLeft.value = 0
    fadeRight.value = 0
    return
  }
  // scrollLeft is 0 at the start edge and negative towards the end in a right-to-left strip.
  const rtl = getComputedStyle(el).direction === 'rtl'
  const [min, max] = rtl ? [-room, 0] : [0, room]
  fadeLeft.value = el.scrollLeft > min + 1 ? FADE_WIDTH : 0
  fadeRight.value = el.scrollLeft < max - 1 ? FADE_WIDTH : 0
}

function revealActive(smooth: boolean) {
  const el = strip.value
  const tab = el?.querySelector<HTMLElement>('[data-active="true"]')
  if (!el || !tab || el.scrollWidth <= el.clientWidth + 1) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  tab.scrollIntoView({ inline: 'center', block: 'nearest', behavior: smooth && !reduced ? 'smooth' : 'auto' })
}

let observer: ResizeObserver | undefined
onMounted(() => {
  revealActive(false)
  syncFade()
  if (strip.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(syncFade)
    observer.observe(strip.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())
watch([activeKey, () => props.items.length], async () => {
  await nextTick()
  revealActive(true)
  syncFade()
})
</script>

<template>
  <div v-if="props.items.length" data-slot="route-tabs-frame" :class="[routeTabsFrameClass, props.variant === 'underline' && props.divider ? routeTabsFrameDividerClass : '']">
    <nav
      ref="strip"
      v-bind="$attrs"
      data-slot="route-tabs"
      :class="props.variant === 'pill' ? routeTabsPillStripClass : routeTabsStripClass"
      :style="fadeStyle"
      :aria-label="props.ariaLabel"
      @scroll.passive="syncFade"
    >
      <template v-for="item in props.items" :key="item.key">
        <span v-if="item.separatorBefore" role="separator" aria-orientation="vertical" :class="routeTabSeparatorClass" />
        <UButton
          color="neutral"
          variant="ghost"
          :class="props.variant === 'pill' ? routeTabPillClass : routeTabClass"
          :to="item.to"
          :aria-current="item.active ? 'page' : undefined"
          :data-active="item.active"
          :data-testid="item.key"
        >
          <UIcon v-if="item.icon" :name="item.icon" aria-hidden="true" class="size-4" />
          <span>{{ item.label }}</span>
          <span v-if="item.count !== undefined && props.variant !== 'pill'" data-slot="route-tab-count" :class="routeTabCountClass">{{ item.count }}</span>
        </UButton>
      </template>
    </nav>
  </div>
</template>
