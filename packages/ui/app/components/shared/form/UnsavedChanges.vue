<script lang="ts">
// A page can mount several guarded forms (the cards of a settings page). Confirming a departure lets every one of
// them through, so leaving asks once and not once per form.
const departure = { confirmed: false }
</script>

<script setup lang="ts">
import type { ModalProps } from '@nuxt/ui'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { takeNavigationFocus } from '../../../composables/useNavigationFocus'

const props = withDefaults(defineProps<{
  dirty: boolean
  guardRouteUpdates?: boolean
  // Query keys the guarded form itself rewrites while editing (a wizard step,
  // for instance): a same-path update that changes only these is not a departure.
  ignoreQueryKeys?: readonly string[]
}>(), {
  guardRouteUpdates: false,
  ignoreQueryKeys: () => [],
})
const pendingPath = ref<string | null>(null)
const leaving = ref(false)
let returnFocus: HTMLElement | null = null

function guardBrowserUnload(event: BeforeUnloadEvent) {
  if (!props.dirty || leaving.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', guardBrowserUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', guardBrowserUnload))

function guard(to: { fullPath: string }) {
  if (!props.dirty || leaving.value || departure.confirmed) return true
  // An overlay that started this navigation and is closing (the palette) hands over where focus belongs.
  if (import.meta.client) returnFocus = takeNavigationFocus() ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  pendingPath.value = to.fullPath
  return false
}

onBeforeRouteLeave(guard)
type Place = { path: string; query: Record<string, unknown> }
// Same path, and every query key outside `ignored` has the same value.
function sameExcept(to: Place, from: Place, ignored: readonly string[]): boolean {
  if (to.path !== from.path) return false
  const keys = new Set([...Object.keys(to.query), ...Object.keys(from.query)])
  for (const key of keys) {
    if (String(to.query[key] ?? '') !== String(from.query[key] ?? '') && !ignored.includes(key)) return false
  }
  return true
}

// A same-path query change (a filter, a tab) is not a departure, so only a
// form that says its own query carries draft state asks to guard those too.
// A hash-only change (scrolling to another card of the page) never is.
onBeforeRouteUpdate((to, from) => {
  if (!props.guardRouteUpdates || sameExcept(to, from, []) || (props.ignoreQueryKeys.length > 0 && sameExcept(to, from, props.ignoreQueryKeys))) return true
  return guard(to)
})

watch(() => props.dirty, dirty => {
  if (!dirty) pendingPath.value = null
})

function restoreFocus() {
  if (!leaving.value && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
}

async function discard() {
  const destination = pendingPath.value
  if (!destination || leaving.value) return
  leaving.value = true
  departure.confirmed = true
  try {
    await navigateTo(destination)
  } finally {
    leaving.value = false
    departure.confirmed = false
  }
}

const dialogContent = computed<NonNullable<ModalProps['content']> & { 'data-testid': string }>(() => ({ 'data-testid': 'unsaved-changes-dialog', onCloseAutoFocus: (event: Event) => { event.preventDefault(); restoreFocus() } }))
</script>

<template>
  <UModal :open="pendingPath !== null" :title="$t('app.unsavedChangesTitle')" :description="$t('app.unsavedChanges')" :close="false"
    :content="dialogContent"
    :ui="{ content: 'z-[150] max-w-md', overlay: 'z-[149]' }"
    @update:open="open => { if (!open && !leaving) pendingPath = null }">
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="leaving" @click="pendingPath = null">{{ $t('app.stay') }}</UButton>
        <UButton type="button" :disabled="leaving" @click="discard">{{ $t('app.discardAndLeave') }}</UButton>
      </div>
    </template>
  </UModal>
</template>
