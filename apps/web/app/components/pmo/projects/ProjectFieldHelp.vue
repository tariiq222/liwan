<script setup lang="ts">
// Hover-open/blur-close, outside-pointerdown dismiss, and Escape dismiss are
// native to UPopover's `mode="hover"` (backed by reka-ui's HoverCard), so no
// document-level listeners or manual outside-target detection are needed
// here. Two small element-bound handlers remain because no single UPopover
// mode covers both of them at once: HoverCardTrigger has no keyboard handling
// at all (so Enter/Space would otherwise do nothing), and its touch support
// reacts to `pointerup`, not the `pointerdown` this component (and its e2e
// coverage) has always toggled on.
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

function onPointerDown(event: PointerEvent) {
  if (event.pointerType !== 'touch') return
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
  if (event.key !== 'Enter' && event.key !== ' ') return
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
    :content="{ side: 'top', align: 'start', collisionPadding: 8 }"
    :ui="{ content: 'px-2 py-1 text-xs' }"
  >
    <UButton
      type="button"
      color="neutral"
      variant="ghost"
      square
      class="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted hover:text-highlighted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      data-testid="field-help"
      :disabled="!hydrated"
      :aria-label="label"
      :aria-describedby="describedBy"
      :aria-expanded="open"
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
