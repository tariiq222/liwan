<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { routeTabPillClass, routeTabsPillStripClass } from '@liwan/ui/app/utils/sectionTabs'

const props = defineProps<{
  tabs: { key: string; label: string; to: RouteLocationRaw; active: boolean }[]
  /** Index of the first log tab; the strip draws a divider before it. */
  logTabStart: number
  label: string
}>()

const { locale } = useI18n()
const root = ref<HTMLElement | null>(null)
let scrollFrame: number | null = null

// A narrow screen scrolls the strip, so the current tab is brought into view.
function scrollActiveTabIntoView() {
  if (!import.meta.client || scrollFrame !== null) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null
    const strip = root.value?.querySelector<HTMLElement>('nav')
    const trigger = strip?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!strip || !trigger) return
    const stripRect = strip.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    const delta = triggerRect.left < stripRect.left
      ? triggerRect.left - stripRect.left
      : triggerRect.right > stripRect.right
        ? triggerRect.right - stripRect.right
        : 0
    if (delta) strip.scrollBy({ left: delta, behavior: 'instant' })
  })
}

watch([() => props.tabs.find(tab => tab.active)?.key, locale, root], scrollActiveTabIntoView, { flush: 'post' })
onMounted(scrollActiveTabIntoView)
onBeforeUnmount(() => {
  if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
  scrollFrame = null
})
</script>

<template>
  <div ref="root" class="min-w-0 max-w-full">
    <!-- Record tabs first, then a divider and the log tabs (history, versions); every tab keeps its own route. -->
    <nav data-testid="meeting-tabs" :class="routeTabsPillStripClass" :aria-label="label">
      <template v-for="(tab, index) in tabs" :key="tab.key">
        <span v-if="index === logTabStart" role="separator" aria-orientation="vertical" class="mx-1 h-5 w-px shrink-0 bg-accented" />
        <UButton color="neutral" variant="ghost" :class="routeTabPillClass" :to="tab.to" :aria-current="tab.active ? 'page' : undefined" :data-active="tab.active" :data-testid="tab.key">
          <span>{{ tab.label }}</span>
        </UButton>
      </template>
    </nav>
  </div>
</template>
