<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import type { CommandPaletteGroup, CommandPaletteItem, CommandPaletteProps } from '@nuxt/ui'
import { useNav, type NavItem } from '@/composables/nav/shellModules'
import {
  commandItems, goToItems, helpItems, paletteGroups, PALETTE_SECTION_LIMIT, visibleCommands, type PaletteItem,
} from '@/composables/nav/paletteModel'
import { isApplePlatform } from '@nasq/ui/app/composables/shortcuts/keymap'
import { useAppSearch } from '@/composables/useAppSearch'
import { paletteNavigationBlocked, shouldRestoreTriggerFocus, usePalette } from '@/composables/usePalette'
import { clearNavigationFocus, offerNavigationFocus } from '@nasq/ui/app/composables/useNavigationFocus'

// The command palette (Tasmim spec §5) and still the one approved search overlay
// (DESIGN.md §5; tools/ui_policy.py OVERLAY_OWNERS): Go to (the nav the user can reach),
// Search (one group per manifest provider), Actions (manifest commands), and the `?`
// shortcut help as a second view of the same dialog. Keys are bound in useShellShortcuts.
const { t, localeProperties } = useI18n()
const { me } = useMe()
const { can } = useAccess()
const { $api } = useApi()
const route = useRoute()
const hydrated = useHydrated()
const { open, view, term, close, reset } = usePalette()
const trimmed = computed(() => term.value.trim())
const debounced = refDebounced(trimmed, 200)
const sections = useAppSearch({ term: trimmed, debounced, gate: open, requireTerm: true, can, api: $api })
// ⌘ on Apple platforms, Ctrl elsewhere; SSR and the first client render agree on ⌘.
const metaKey = ref('⌘')
onMounted(() => { if (!isApplePlatform(navigator)) metaKey.value = 'Ctrl ' })
watch(() => route.fullPath, () => { if (open.value) close() })

function navLabel(item: NavItem) {
  return item.to === '/projects/settings' ? t('nav.projectSettings') : t(item.labelKey)
}
const sectionFor = (id: string) => sections.find(section => section.provider.id === id)
const searching = computed(() => !!trimmed.value && sections.some(section => section.visible.value && section.waiting.value))

// A link selection that leaves the page hands focus to the layout, which focuses <main>
// after the route changes; otherwise reka returns focus to the trigger or to the element
// that had it when ⌘K was pressed. The destination is compared with the page the palette was
// opened on, not with the route at close time: the navigation has usually finished by then, and
// restoring focus would then pull it back from <main> to the trigger.
// When a guard blocks that navigation (an unsaved draft), the page does not change: the trigger
// is handed to the draft guard for after its dialog, and focus goes back to it (Tasmim Plan 4).
let leavingFor: string | null = null
let leavingFrom = ''
let paletteNavigation = false
let closedWithoutRestore = false
const router = useRouter()
const triggerElement = () => document.querySelector<HTMLElement>('[data-testid="global-search-trigger"]')
function pathOf(to: PaletteItem['to']): string | null {
  if (typeof to === 'string') return to.split(/[?#]/, 1)[0] ?? to
  return to && typeof to === 'object' && 'path' in to && typeof to.path === 'string' ? to.path : null
}
function onCloseAutoFocus(event: Event) {
  closedWithoutRestore = !shouldRestoreTriggerFocus(leavingFor, leavingFrom)
  if (closedWithoutRestore) event.preventDefault()
  leavingFor = null
}
const stopAfterEach = router.afterEach((_to, _from, failure) => {
  const fromPalette = paletteNavigation
  paletteNavigation = false
  clearNavigationFocus()
  if (!fromPalette || !paletteNavigationBlocked(failure)) return
  // Still closing: reka restores the trigger. Already closed: restore it, unless a dialog (the draft guard) holds focus.
  leavingFor = null
  if (closedWithoutRestore && document.activeElement === document.body) triggerElement()?.focus({ preventScroll: true })
})
onBeforeUnmount(stopAfterEach)
// A selection that never produced a navigation must not leave the hand-off armed for an
// unrelated, later draft guard: each new opening starts clean.
watch(open, isOpen => {
  if (!isOpen) return
  paletteNavigation = false
  clearNavigationFocus()
})
function toItem(item: PaletteItem): CommandPaletteItem {
  const { action, ...rest } = item
  return {
    ...rest,
    onSelect(event: Event) {
      if (!action) {
        leavingFor = item.external ? null : pathOf(item.to)
        leavingFrom = route.path
        closedWithoutRestore = false
        if (leavingFor !== null) {
          paletteNavigation = true
          offerNavigationFocus(triggerElement)
        }
        close()
        return
      }
      event.preventDefault()
      if (action.kind === 'shortcuts') view.value = 'shortcuts'
      else if (action.kind === 'retry') sectionFor(action.section)?.refetch()
    },
  }
}
// The input forwards unknown attributes to the field; its prop type does not list aria-label.
const inputProps = computed(() => ({ id: 'global-search-input', 'aria-label': t('app.search'), autocomplete: 'off' }) as CommandPaletteProps['input'])
// Nuxt UI renders the results listbox without a name and its scroll viewport without a tab stop
// (axe: aria-input-field-name, scrollable-region-focusable) and exposes no prop for either, so
// both are set on the rendered nodes whenever the palette mounts or updates (vnode hooks below).
// Options stay reachable through the input.
function nameResults() {
  // The palette's root is a fragment, so its vnode has no element; the nodes are found by test id, after the DOM patch.
  void nextTick(patchResults)
}
function patchResults() {
  const root = document.querySelector('[data-testid="command-palette"]')
  root?.querySelector('[role="listbox"]')?.setAttribute('aria-label', view.value === 'shortcuts' ? t('shortcuts.title') : t('app.search'))
  // A focusable viewport is no longer presentational, so it becomes a plain group (a listbox may own groups).
  const viewport = root?.querySelector('[data-slot="viewport"]')
  viewport?.setAttribute('tabindex', '0')
  viewport?.setAttribute('role', 'group')
}
function onBackspace() {
  if (view.value === 'shortcuts' && !term.value) view.value = 'main'
}

const liveGroups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
  if (!open.value) return []
  const visible = useNav(me.value)
  const shortcutsEntry: PaletteItem = { id: 'command:shortcuts', label: t('shortcuts.title'), icon: 'i-lucide-keyboard', kbds: ['?'], kbdsHidden: true, action: { kind: 'shortcuts' } }
  return paletteGroups({
    view: view.value,
    term: trimmed.value,
    goTo: goToItems(visible, navLabel),
    search: sections.filter(section => section.visible.value).map(section => ({
      id: section.provider.id,
      label: t(section.provider.labelKey),
      icon: section.provider.icon,
      rows: section.rows.value,
      waiting: section.waiting.value,
      error: !!section.error.value,
      hasNext: section.hasNext.value,
      notice: section.truncated.value && section.provider.truncatedKey ? t(section.provider.truncatedKey) : null,
    })),
    actions: [...commandItems(visibleCommands(me.value), key => t(key), route.fullPath), shortcutsEntry],
    help: helpItems(visible, key => t(key), item => t('shortcuts.goTo', { name: navLabel(item) })),
    returnTo: route.fullPath,
    labels: {
      goTo: t('nav.goTo'), actions: t('search.actions'), shortcuts: t('shortcuts.title'),
      loading: t('search.loading'), error: t('search.error'), loadMore: t('app.loadMore'),
    },
  }).map(group => ({ ...group, items: group.items.map(toItem) }))
})
// Closing keeps the last rows (and, in usePalette, the typed term) on screen while the exit animation
// runs; without it the empty state and an emptied input flash. `after:leave` clears them.
const groups = shallowRef<CommandPaletteGroup<CommandPaletteItem>[]>([])
watch(liveGroups, value => { if (open.value) groups.value = value }, { flush: 'sync', immediate: true })
function onAfterLeave() {
  if (open.value) return
  groups.value = []
  reset()
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('app.search')"
    :description="t('search.description')"
    :content="{ onCloseAutoFocus }"
    @after:leave="onAfterLeave"
    :ui="{ content: 'nasq-search-dialog max-w-2xl max-h-[min(620px,calc(100dvh-2rem))] gap-0 divide-y-0 overflow-hidden rounded-xl p-0', overlay: 'nasq-search-overlay' }"
  >
    <UButton
      :aria-label="t('app.search')"
      aria-keyshortcuts="Meta+K Control+K"
      color="neutral"
      variant="outline"
      class="nasq-search-trigger max-md:bg-transparent max-md:ring-0"
      data-testid="global-search-trigger"
      :disabled="!hydrated"
    >
      <span class="flex min-w-0 items-center gap-2">
        <UIcon name="i-lucide-search" class="size-4 shrink-0" aria-hidden="true" />
        <span data-slot="label" class="nasq-search-trigger-label truncate">{{ t('app.search') }}</span>
      </span>
      <UKbd dir="ltr">{{ metaKey }}K</UKbd>
    </UButton>
    <template #content>
      <UCommandPalette
        v-model:search-term="term"
        :groups="groups"
        :placeholder="view === 'shortcuts' ? t('shortcuts.filter') : t('search.description')"
        :input="inputProps"
        :loading="searching"
        :fuse="{ resultLimit: PALETTE_SECTION_LIMIT + 3 }"
        preserve-group-order
        :dir="localeProperties.dir"
        :data-view="view"
        data-testid="command-palette"
        class="max-h-[min(620px,calc(100dvh-2rem))]"
        @vue:mounted="nameResults"
        @vue:updated="nameResults"
        @keydown.backspace="onBackspace"
      >
        <template #close>
          <div class="flex shrink-0 items-center gap-1">
            <UButton
              v-if="view === 'shortcuts'"
              color="neutral"
              variant="ghost"
              square
              icon="i-lucide-arrow-left"
              :ui="{ leadingIcon: 'rtl:-scale-x-100' }"
              :aria-label="t('shortcuts.backToCommands')"
              data-testid="palette-back"
              @click="view = 'main'"
            />
            <UButton color="neutral" variant="ghost" square icon="i-lucide-x" :aria-label="t('search.close')" @click="close()" />
          </div>
        </template>
        <template #item-trailing="{ item }">
          <span v-if="item.kbds?.length" class="flex shrink-0 items-center gap-0.5" dir="ltr" :aria-hidden="item.kbdsHidden ? 'true' : undefined">
            <template v-for="kbd in item.kbds" :key="typeof kbd === 'string' ? kbd : kbd?.value">
              <UKbd v-if="typeof kbd === 'string'" :value="kbd" size="sm" />
            </template>
          </span>
        </template>
        <template #empty>
          <p class="px-4 py-10 text-center text-base text-muted">{{ t('app.noResults') }}</p>
        </template>
        <template #footer>
          <p v-if="view === 'shortcuts'" class="text-xs text-muted" data-testid="palette-footer">{{ t('shortcuts.layoutNote') }}</p>
          <div v-else class="flex flex-wrap items-center gap-3 text-xs text-muted" data-testid="palette-footer">
            <span class="flex items-center gap-1">
              <span class="flex gap-0.5" dir="ltr" aria-hidden="true"><UKbd value="arrowup" size="sm" /><UKbd value="arrowdown" size="sm" /></span>
              {{ t('search.footerMove') }}
            </span>
            <span class="flex items-center gap-1"><UKbd value="enter" size="sm" aria-hidden="true" />{{ t('search.footerOpen') }}</span>
            <span class="flex items-center gap-1"><UKbd value="escape" size="sm" aria-hidden="true" />{{ t('search.footerClose') }}</span>
          </div>
        </template>
      </UCommandPalette>
    </template>
  </UModal>
</template>
