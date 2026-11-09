<script setup lang="ts">
// Hover-open/blur-close, outside-pointerdown dismiss, and Escape dismiss are
// native to UPopover's `mode="hover"` (backed by reka-ui's HoverCard), so no
// document-level listeners or manual outside-target detection are needed
// here. Element-bound handlers retain keyboard/touch toggling and settle
// focus opening after the browser scrolls an offscreen trigger into view.
const props = defineProps<{
  text: string
  label: string
  helpId?: string
}>()

const open = ref(false)
const hydrated = useHydrated()
const generatedId = useId()
const tooltipId = computed(() => props.helpId || generatedId)
const describedBy = computed(() => (open.value ? tooltipId.value : undefined))
let focusFrame: number | undefined
function cancelFocusOpen() {
  if (focusFrame === undefined) return
  cancelAnimationFrame(focusFrame)
  focusFrame = undefined
}
function onFocus(event: FocusEvent) {
  cancelFocusOpen()
  const trigger = event.currentTarget as HTMLElement
  // HoverCard dismisses on scroll. Browser focus autoscroll runs before this
  // frame, so the focused trigger can open after that initial notification.
  focusFrame = requestAnimationFrame(() => {
    focusFrame = undefined
    if (trigger.isConnected && trigger.ownerDocument.activeElement === trigger) open.value = true
  })
}
function onBlur() { cancelFocusOpen() }
onBeforeUnmount(cancelFocusOpen)

function onPointerDown(event: PointerEvent) {
  if (event.pointerType !== 'touch') return
  cancelFocusOpen()
  event.preventDefault()
  event.stopPropagation()
  open.value = !open.value
}

// Swallow the click so it never bubbles into a surrounding <label> or <form>
// (which would otherwise focus/activate the field this help bubble sits
// beside, or submit an enclosing form).
function onClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') cancelFocusOpen()
  if (event.key !== 'Enter' && event.key !== ' ') return
  cancelFocusOpen()
  event.preventDefault()
  event.stopPropagation()
  open.value = !open.value
}
</script>

<template>
  <UPopover
    v-model:open="open"
    mode="hover"
    :open-delay="0"
    :close-delay="0"
    :content="{ side: 'top', align: 'start', collisionPadding: 8, onPointerDownOutside: cancelFocusOpen, onEscapeKeyDown: cancelFocusOpen }"
    :ui="{ content: 'px-2 py-1 text-xs' }"
  >
    <UButton
      type="button"
      color="neutral"
      variant="ghost"
      square
      class="inline-flex size-6 shrink-0 items-center justify-center rounded-inner text-muted hover:text-highlighted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      data-testid="field-help"
      :disabled="!hydrated"
      :aria-label="label"
      :aria-describedby="describedBy"
      :aria-expanded="open"
      @focus="onFocus"
      @blur="onBlur"
      @pointerdown="onPointerDown"
      @click="onClick"
      @keydown="onKeydown"
    >
      <span aria-hidden="true">ⓘ</span>
    </UButton>
    <template #content>
      <p :id="tooltipId" role="tooltip" class="max-w-xs text-start">{{ text }}</p>
    </template>
  </UPopover>
</template>
