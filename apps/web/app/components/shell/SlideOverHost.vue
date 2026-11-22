<script setup lang="ts">
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import NotificationsPanel from '@/components/notifications/NotificationsPanel.vue'
import { assistantBodyView, useAssistantSheet } from '@/composables/useAssistantSheet'
import { useShellModel } from '@/composables/useShellModel'
import { ASSISTANT_PANEL, NOTIFICATIONS_PANEL, slideOverId, useSlideOver } from '@/composables/useSlideOver'

// Hosts the top bar's two slide-overs: the notifications and the assistant. One is open at a time. The assistant's
// body is declared by its application and loads lazily (R3: the shell imports no application code); it stays mounted
// after its first open so a half-typed message survives closing. The application tool panels were removed from this
// host on 2026-11-21 (DESIGN.md §3): the sidebar and the phone tab bar open those pages directly.
const { t } = useI18n()
const route = useRoute()
const slideOver = useSlideOver()
const assistant = useAssistantSheet()
const { activeModule } = useShellModel()

interface HostedPanel { id: string; title: string; allTo: RouteLocationRaw; allLabel: string; body: Component; flush?: boolean; keep?: boolean; icon: string }
const hosted = computed<HostedPanel[]>(() => [
  { id: NOTIFICATIONS_PANEL, title: t('notifications.title'), allTo: '/notifications', allLabel: t('nav.panel.openAll'), body: NotificationsPanel, icon: 'i-lucide-bell' },
  ...(assistant.surface.value && assistant.showButton.value
    ? [{ id: ASSISTANT_PANEL, title: t(assistant.surface.value.labelKey), allTo: assistant.fullPageTo(activeModule.value), allLabel: t('nav.assistantSheet.openFullPage'), body: assistantBodyView(assistant.surface.value), flush: true, keep: true, icon: 'i-lucide-sparkles' }]
    : []),
])
const openedBefore = ref(new Set<string>())
const mounted = computed(() => hosted.value.filter(panel => slideOver.open.value === panel.id || (panel.keep && openedBefore.value.has(panel.id))))
watch(slideOver.open, (id) => {
  if (!id) return
  openedBefore.value.add(id)
  void nextTick(() => focusInto(id))
}, { flush: 'post' })

// The assistant's message field takes focus; any other panel takes focus itself so keyboard and screen-reader users
// land inside it, and Escape or the close button return them to the button that opened it.
function focusInto(id: string) {
  const panel = document.getElementById(slideOverId(id))
  const field = id === ASSISTANT_PANEL ? panel?.querySelector<HTMLElement>('textarea, input:not([type="hidden"]), [contenteditable="true"]') : null
  ;(field ?? panel)?.focus({ preventScroll: true })
}
// The body of the assistant arrives after the panel opens; focus moves on to its field once it is there.
watch(assistant.bodyLoaded, (loaded) => {
  if (loaded && slideOver.open.value === ASSISTANT_PANEL) focusInto(ASSISTANT_PANEL)
})

// A page change closes the panel without taking focus back from the new page; so does reaching the assistant's own
// page, a panel a tool or the assistant no longer offers, and Escape or the close button through `close`.
watch(() => route.fullPath, () => slideOver.close({ restoreFocus: false }))
watch(() => slideOver.open.value !== null && !hosted.value.some(panel => panel.id === slideOver.open.value), (gone) => {
  if (gone) slideOver.close({ restoreFocus: false })
})
</script>

<template>
  <ShellSlideOver
    v-for="panel in mounted"
    :id="slideOverId(panel.id)"
    :key="panel.id"
    :open="slideOver.open.value === panel.id"
    :title="panel.title"
    :close-label="t('nav.panel.close')"
    :all-to="panel.allTo"
    :all-label="panel.allLabel"
    :flush="panel.flush"
    @close="slideOver.close()"
  >
    <template #lead><ShellAppTile :icon="panel.icon" size="md" :app="panel.id === ASSISTANT_PANEL || panel.id === NOTIFICATIONS_PANEL ? undefined : panel.id" /></template>
    <component :is="panel.body" />
  </ShellSlideOver>
</template>
