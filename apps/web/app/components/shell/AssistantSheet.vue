<script setup lang="ts">
import { useEventListener, useMediaQuery } from '@vueuse/core'
import { assistantBodyView, assistantEscapeCloses, assistantSheetMode, ASSISTANT_SHEET_ID, holdPageBehind, useAssistantSheet } from '@/composables/useAssistantSheet'
import { useShellModel } from '@/composables/useShellModel'
import type { AppAssistantSurface } from '@/modules/types'
import { overlayOwnsEscape } from '@liwan/ui/app/composables/useEscapeBack'

// The assistant sheet's host: an aside docked on the inline-end side beside the page. The shell owns only the frame
// (header row, close, "open full page"); the body is the assistant application's own component, loaded lazily on the
// first open and kept mounted afterwards so a half-typed message survives closing. The layout mounts this only when
// the user may use the surface, so a user without it gets no listener from here.
const props = defineProps<{ surface: AppAssistantSurface }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { rail, activeModule } = useShellModel()
const sheet = useAssistantSheet()
const wide = useMediaQuery('(min-width: 1100px)', { ssrWidth: 1100 })
const desktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const mode = computed(() => assistantSheetMode(wide.value, desktop.value))
const body = computed(() => assistantBodyView(props.surface))
const moduleLabel = computed(() => {
  const owner = rail.value.all.find(item => item.id === activeModule.value)
  return owner ? t(owner.labelKey) : null
})
const fullPageTo = computed(() => sheet.fullPageTo(activeModule.value))
const scrimShown = computed(() => sheet.shown.value && mode.value === 'overlay')

const panel = ref<HTMLElement | null>(null)
// The body mounts on the first open, never before.
const everOpened = ref(sheet.shown.value)
watch(sheet.shown, (shown) => {
  if (!shown) return
  everOpened.value = true
  if (sheet.takeFocusRequest()) focusInto()
}, { flush: 'post' })

// The assistant's full page replaces the sheet; this also clears a stale open state kept from an earlier page.
watch(sheet.onSurfacePage, (onPage) => {
  if (onPage) sheet.close({ restoreFocus: false })
}, { immediate: true })

// A sheet left open earlier in this session returns on a wide screen once hydrated, without taking focus.
watch(hydrated, (ready) => {
  if (ready) sheet.restoreSession(wide.value)
}, { immediate: true })

// Focus goes to the message field when the body offers one, else to the first control of the sheet.
function focusInto() {
  const field = panel.value?.querySelector<HTMLElement>('textarea, input:not([type="hidden"]), [contenteditable="true"]')
  const first = panel.value?.querySelector<HTMLElement>('a[href], button:not([disabled])')
  ;(field ?? first)?.focus()
}
// The body arrives after the sheet opens; if focus is still on the frame's own controls, it moves on to the field.
watch(sheet.bodyLoaded, (loaded) => {
  if (loaded && sheet.shown.value && panel.value?.querySelector('[data-slot="assistant-head"]')?.contains(document.activeElement)) focusInto()
})

// Full screen is a modal dialog: the rest of the shell is made inert and the page stops scrolling behind it, both
// undone when the sheet closes or leaves full-screen mode. Client only.
let releaseModal: (() => void) | null = null
watch([() => sheet.shown.value, mode], ([shown, current]) => {
  releaseModal?.()
  releaseModal = shown && current === 'full' && panel.value ? holdPageBehind(panel.value, document.body) : null
}, { flush: 'post' })
onBeforeUnmount(() => releaseModal?.())

// Capture phase and stopPropagation: Escape that closes the sheet must not also leave the record behind it.
useEventListener(() => (typeof document === 'undefined' ? undefined : document), 'keydown', (event: KeyboardEvent) => {
  const insideSheet = !!panel.value?.contains(event.target as Node | null)
  if (!assistantEscapeCloses(event, { shown: sheet.shown.value, mode: mode.value, insideSheet, overlayOpen: overlayOwnsEscape(document) })) return
  event.stopPropagation()
  sheet.close()
}, { capture: true })
</script>

<template>
  <div v-if="scrimShown" class="liwan-assistant-scrim" data-testid="assistant-scrim" aria-hidden="true" @click="sheet.close()" />
  <Transition name="liwan-assistant-sheet">
    <aside
      v-show="sheet.shown.value"
      :id="ASSISTANT_SHEET_ID"
      ref="panel"
      class="liwan-assistant-sheet"
      data-testid="assistant-sheet"
      :data-mode="mode"
      :role="mode === 'full' ? 'dialog' : undefined"
      :aria-modal="mode === 'full' ? 'true' : undefined"
      :aria-label="t('nav.assistantSheet.region')"
    >
      <div class="liwan-assistant-head" data-slot="assistant-head">
        <span class="liwan-assistant-mark" aria-hidden="true"><UIcon name="i-lucide-sparkles" class="size-4" /></span>
        <h2 class="liwan-assistant-title">{{ t(props.surface.labelKey) }}</h2>
        <span v-if="moduleLabel" class="liwan-assistant-module" data-testid="assistant-sheet-module">{{ moduleLabel }}</span>
        <span class="liwan-assistant-head-space" />
        <NuxtLink :to="fullPageTo" class="liwan-assistant-action" data-testid="assistant-sheet-full-page" :title="t('nav.assistantSheet.openFullPage')" :aria-label="t('nav.assistantSheet.openFullPage')">
          <UIcon name="i-lucide-maximize-2" class="size-4" aria-hidden="true" />
        </NuxtLink>
        <button type="button" class="liwan-assistant-action" data-testid="assistant-sheet-close" :title="t('nav.assistantSheet.close')" :aria-label="t('nav.assistantSheet.close')" @click="sheet.close()">
          <UIcon name="i-lucide-x" class="size-4" aria-hidden="true" />
        </button>
      </div>
      <div class="liwan-assistant-body">
        <component :is="body" v-if="everOpened" />
      </div>
    </aside>
  </Transition>
</template>
