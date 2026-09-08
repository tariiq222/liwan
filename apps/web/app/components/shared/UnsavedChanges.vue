<script setup lang="ts">
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { AlertDialogRoot, AlertDialogPortal, AlertDialogOverlay, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from 'reka-ui'

const props = withDefaults(defineProps<{ dirty: boolean; guardRouteUpdates?: boolean }>(), {
  guardRouteUpdates: false,
})
const pendingPath = ref<string | null>(null)
const leaving = ref(false)
let returnFocus: HTMLElement | null = null

function guard(to: { fullPath: string }) {
  if (!props.dirty || leaving.value) return true
  if (import.meta.client) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  pendingPath.value = to.fullPath
  return false
}

onBeforeRouteLeave(guard)
onBeforeRouteUpdate(to => props.guardRouteUpdates ? guard(to) : true)

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
      <AlertDialogOverlay class="fixed inset-0 z-50 bg-black/30" />
      <AlertDialogContent
        data-testid="unsaved-changes-dialog"
        @close-auto-focus.prevent="restoreFocus"
        class="fixed start-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[420px] -translate-y-1/2 rounded-lg border bg-card p-6 text-start text-card-foreground shadow-lg ltr:-translate-x-1/2 rtl:translate-x-1/2"
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
