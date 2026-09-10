<script setup lang="ts">
import { inject } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { AlertDialogRoot, AlertDialogPortal, AlertDialogOverlay, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from 'reka-ui'
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
</script>

<template>
  <AlertDialogRoot :open="pendingPath !== null" @update:open="open => { if (!open && !leaving) pendingPath = null }">
    <AlertDialogPortal>
      <AlertDialogOverlay :class="['fixed inset-0 bg-black/30', inProjectOverlay ? 'z-[119]' : 'z-50']" />
      <AlertDialogContent
        data-testid="unsaved-changes-dialog"
        @close-auto-focus.prevent="restoreFocus"
        :class="['fixed start-1/2 top-1/2 w-[calc(100%-2rem)] max-w-[420px] -translate-y-1/2 rounded-lg border bg-card p-6 text-start text-card-foreground shadow-lg ltr:-translate-x-1/2 rtl:translate-x-1/2', inProjectOverlay ? 'z-[120]' : 'z-50']"
      >
        <AlertDialogTitle class="text-base font-semibold">{{ $t('app.unsavedChangesTitle') }}</AlertDialogTitle>
        <AlertDialogDescription class="mt-2 text-sm leading-6 text-muted-foreground">{{ $t('app.unsavedChanges') }}</AlertDialogDescription>
        <div class="mt-6 flex flex-wrap justify-end gap-2">
          <AlertDialogCancel as-child>
            <Button type="button" variant="outline" :disabled="leaving">{{ $t('app.stay') }}</Button>
          </AlertDialogCancel>
          <Button type="button" :disabled="leaving" @click="discard">{{ $t('app.discardAndLeave') }}</Button>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
