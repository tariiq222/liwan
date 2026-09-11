<script setup lang="ts">
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
const triggerRef = ref<{ $el?: Element } | HTMLButtonElement | null>(null)

function triggerElement(): HTMLElement | null {
  const value = triggerRef.value
  if (value instanceof HTMLElement) return value
  return value?.$el instanceof HTMLElement ? value.$el : null
}

function isTouchPointer(event: PointerEvent): boolean {
  return event.pointerType === 'touch'
}

function isHelpSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false
  if (triggerElement()?.contains(target)) return true
  const content = document.getElementById(tooltipId.value)
  return !!content?.contains(target)
}

function openHelp() {
  open.value = true
}

function closeHelp() {
  open.value = false
}

function toggleHelp() {
  open.value = !open.value
}

function onFocus() {
  openHelp()
}

function onBlur(event: FocusEvent) {
  if (isHelpSurface(event.relatedTarget)) return
  closeHelp()
}

function onPointerEnter(event: PointerEvent) {
  if (isTouchPointer(event)) return
  openHelp()
}

function onPointerLeave(event: PointerEvent) {
  if (isTouchPointer(event)) return
  if (triggerElement()?.contains(document.activeElement)) return
  closeHelp()
}

function onPointerDown(event: PointerEvent) {
  if (!isTouchPointer(event)) return
  event.preventDefault()
  event.stopPropagation()
  toggleHelp()
}

function onClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeHelp()
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    event.stopPropagation()
    toggleHelp()
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!open.value) return
  if (isHelpSurface(event.target)) return
  closeHelp()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (!open.value || event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  closeHelp()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onDocumentKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onDocumentKeydown, true)
})
</script>

<template>
  <UTooltip :open="open" :delay-duration="0" disable-hoverable-content :content="{ side: 'top', align: 'start' }">
    <UButton
      ref="triggerRef"
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
      @focus="onFocus"
      @blur="onBlur"
      @pointerenter="onPointerEnter"
      @pointerleave="onPointerLeave"
      @pointerdown="onPointerDown"
      @click="onClick"
      @keydown="onKeydown"
    >
      <span aria-hidden="true">ⓘ</span>
    </UButton>
    <template #content>
      <p :id="tooltipId" role="tooltip" class="max-w-xs text-start">{{ text }}</p>
    </template>
  </UTooltip>
</template>
