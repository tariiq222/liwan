<script setup lang="ts">
import type { ModalProps } from '@nuxt/ui'
import { inject } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { PROJECT_OVERLAY_INJECTION_KEY, wantsProjectOverlayFullPage } from '@/utils/projectOverlayRoute'
import { isWorkspaceOverlayRoute } from '@/utils/workspacePresentation'

const props = withDefaults(defineProps<{ dirty: boolean; guardRouteUpdates?: boolean }>(), {
  guardRouteUpdates: false,
})
const inProjectOverlay = inject<boolean>(PROJECT_OVERLAY_INJECTION_KEY, false)
const guardRouteUpdates = computed(() => props.guardRouteUpdates || inProjectOverlay === true)
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
  if (!props.dirty || leaving.value) return true
  if (import.meta.client) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  pendingPath.value = to.fullPath
  return false
}

function isProjectPresentationTransition(to: { path: string; query: Record<string, unknown> }, from: { path: string; query: Record<string, unknown> }) {
  const fromIsWorkflow = isWorkspaceOverlayRoute(from)
  const toIsWorkflow = isWorkspaceOverlayRoute(to)
  if (!fromIsWorkflow || !toIsWorkflow) return false
  return wantsProjectOverlayFullPage(from.query) !== wantsProjectOverlayFullPage(to.query)
}

onBeforeRouteLeave(guard)
onBeforeRouteUpdate((to, from) => {
  const presentationTransition = isProjectPresentationTransition(
    to as { path: string; query: Record<string, unknown> },
    from as { path: string; query: Record<string, unknown> },
  )
  return guardRouteUpdates.value || presentationTransition ? guard(to) : true
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
  try {
    await navigateTo(destination)
  } finally {
    leaving.value = false
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
        <UButton type="button" color="secondary" :disabled="leaving" @click="pendingPath = null">{{ $t('app.stay') }}</UButton>
        <UButton type="button" :disabled="leaving" @click="discard">{{ $t('app.discardAndLeave') }}</UButton>
      </div>
    </template>
  </UModal>
</template>
