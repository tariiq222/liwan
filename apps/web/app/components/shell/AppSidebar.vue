<script setup lang="ts">
import { useElementSize, useEventListener, useMediaQuery } from '@vueuse/core'
import ModuleRail from '@liwan/ui/app/components/shell/ModuleRail.vue'
import { hasNoContextSidebar } from './noContextRoutes'
import ShellNavigation from '@liwan/ui/app/components/shell/ShellNavigation.vue'
import type { ShellNavigationItem } from '@liwan/ui/app/types/shell'
import { overlayOwnsEscape } from '@liwan/ui/app/composables/useEscapeBack'
import { useApplicationNavigation } from '@/composables/useApplicationNavigation'
import { useContextSidebar } from '@/composables/useShellNavigation'
import { useContextPeek } from '@/composables/useContextPeek'
import { isSidebarToggleShortcut } from '@/composables/nav/sidebarShortcut'
import { aimsAtMenu, type AimPoint } from '@/composables/nav/menuAim'

const route = useRoute()
const navigation = useApplicationNavigation()
const { expanded, hydrated, forced, toggle, preference } = useContextSidebar()
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const canHover = useMediaQuery('(hover: hover)', { ssrWidth: 1024 })
const overlay = computed(() => hydrated.value && isDesktop.value && canHover.value && !expanded.value && !forced.value)
const { peekId, pinnedId, anchorTop, peek, keep, release, close, dismissOnEscape, pin, unpin } = useContextPeek(overlay)
watch(navigation.routeKey, () => { close(); unpin() })
watch(expanded, value => { if (!value) unpin() })
const hasMenu = (item: ShellNavigationItem) => !item.panel && !!(item.sections.length || item.views.length || item.actions.length)
const menuItem = (id: string | null) => navigation.items.value.find(item => item.id === id && hasMenu(item)) ?? null
const peekItem = computed(() => menuItem(peekId.value))
const shownItem = computed(() => peekItem.value ?? menuItem(pinnedId.value))
const contextItems = computed(() => shownItem.value ? [shownItem.value] : navigation.items.value.filter(item => item.id === navigation.activeId.value))
const column = ref<HTMLElement | null>(null)
const { height: columnHeight } = useElementSize(column, undefined, { box: 'border-box' })
// A hovered menu opens level with its rail item; shell.css only lifts it to keep it on screen.
const anchorStyle = computed(() => peekItem.value && anchorTop.value !== null
  ? { '--peek-top': `${anchorTop.value}px`, '--peek-height': `${columnHeight.value}px` }
  : undefined)
// The pointer path while a menu is open: a rail item crossed on the way into the menu must not take it over.
const AIM_SAMPLE_MS = 80
const trail: (AimPoint & { at: number })[] = []
useEventListener(() => typeof document === 'undefined' ? null : document, 'pointermove', (event: PointerEvent) => {
  if (event.pointerType !== 'mouse' || !peekItem.value) return
  trail.push({ x: event.clientX, y: event.clientY, at: event.timeStamp })
  while (trail.length > 1 && event.timeStamp - trail[0]!.at > AIM_SAMPLE_MS) trail.shift()
}, { passive: true })
// A trail older than the sample window (a resting pointer, or keyboard focus) says nothing about where it is heading.
function aimingAtMenu() {
  const from = trail[0]
  const to = trail.at(-1)
  if (!from || !to || from === to || performance.now() - to.at > AIM_SAMPLE_MS) return false
  const menu = column.value?.querySelector('.liwan-context-sidebar')?.getBoundingClientRect()
  return !!menu && aimsAtMenu(from, to, menu)
}
function peekFrom(id: string, anchor: HTMLElement) {
  peek(id, anchor.getBoundingClientRect().top, !!peekItem.value && id !== peekId.value && aimingAtMenu())
}
const releaseFromRail = () => release(!!peekItem.value && aimingAtMenu())
const showContext = computed(() => !!shownItem.value || (!hasNoContextSidebar(route.path) && contextItems.value.length > 0))
function toggleSidebar() {
  pin()
  toggle()
}
// Focus stays on the rail link that opened a hovered menu, so Escape is read before any page handler.
useEventListener(() => typeof document === 'undefined' ? null : document, 'keydown', (event: KeyboardEvent) => {
  if (!overlayOwnsEscape(document)) dismissOnEscape(event)
}, { capture: true })
useEventListener('keydown', (event: KeyboardEvent) => {
  if (!isDesktop.value || !isSidebarToggleShortcut(event, overlayOwnsEscape(document))) return
  event.preventDefault()
  toggleSidebar()
})
</script>

<template>
  <ModuleRail :rail="navigation.rail.value" :active-id="navigation.railActive.value" :home-to="navigation.homePath.value" @peek="peekFrom" @release="releaseFromRail" />
  <div v-if="showContext" ref="column" class="liwan-context-column" :data-anchored="anchorStyle ? 'true' : undefined" :style="anchorStyle" @pointerenter="keep" @pointerleave="release()" @focusin="keep" @focusout="release()">
    <ShellNavigation
      surface="context"
      :items="contextItems"
      :title="shownItem?.label ?? navigation.title.value"
      hide-brand
      :active-id="shownItem?.id ?? navigation.activeId.value"
      :route-key="navigation.routeKey.value"
      :home-to="navigation.homePath.value"
      :expanded="expanded || !!peekItem"
      :overlay="!!peekItem"
      :hydrated="hydrated"
      :locked="forced"
      :preference="preference"
      :show-panel="isDesktop"
      :panel-width="navigation.panel.value?.width ?? 'default'"
      @toggle="toggleSidebar"
    >
      <template #panel><component :is="navigation.panelView.value" v-if="navigation.panelView.value" /></template>
    </ShellNavigation>
  </div>
</template>
