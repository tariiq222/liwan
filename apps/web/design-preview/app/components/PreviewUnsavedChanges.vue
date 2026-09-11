<script setup lang="ts">
// Preserve the production guard's cancel-then-navigate semantics, using Nuxt UI.
const props = defineProps<{ dirty: boolean }>()
const { t } = usePreview()
const pending = ref<string | null>(null)
const leaving = ref(false)
let returnFocus: HTMLElement | null = null
function guard(to: { fullPath: string }) {
  if (!props.dirty || leaving.value) return true
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  pending.value = to.fullPath
  return false
}
onBeforeRouteLeave(guard)
onBeforeRouteUpdate(guard)
watch(() => props.dirty, dirty => { if (!dirty) pending.value = null })
function beforeUnload(event: BeforeUnloadEvent) {
  if (props.dirty) { event.preventDefault(); event.returnValue = '' }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
function restoreFocus(event: Event) {
  event.preventDefault()
  if (!leaving.value && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
}
async function discard() {
  if (!pending.value || leaving.value) return
  leaving.value = true
  try { await navigateTo(pending.value); pending.value = null } finally { leaving.value = false }
}
</script>
<template>
  <UModal :open="pending !== null" :title="t('unsavedTitle')" :description="t('unsavedHint')" :dismissible="!leaving" :content="{ onCloseAutoFocus: restoreFocus }" @update:open="value => { if (!value && !leaving) pending = null }">
    <template #footer>
      <div class="flex flex-wrap gap-2 justify-end w-full">
        <UButton color="neutral" variant="outline" :label="t('stay')" :disabled="leaving" @click="pending = null" />
        <UButton :label="t('discard')" :loading="leaving" @click="discard" />
      </div>
    </template>
  </UModal>
</template>
