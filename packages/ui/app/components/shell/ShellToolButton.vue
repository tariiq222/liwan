<script setup lang="ts">
// An icon button of the top bar with an optional badge: a number, or `dot` for "something new". The personal tools
// toggle a slide-over (`aria-expanded`, `aria-controls`); the theme and switcher buttons use the `outline` variant.
const props = withDefaults(defineProps<{
  icon: string
  label: string
  badge?: number | 'dot' | null
  open?: boolean
  variant?: 'tool' | 'outline'
  controls?: string
  /** Menu or panel the button opens, for assistive technology. */
  haspopup?: 'dialog' | 'menu'
  /** Phones show only the notifications tool; the others hide. */
  hideOnMobile?: boolean
  disabled?: boolean
  badgeTestId?: string
}>(), { variant: 'tool' })
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const badgeText = computed(() => (typeof props.badge === 'number' ? (props.badge > 99 ? '99+' : String(props.badge)) : ''))
const hasBadge = computed(() => props.badge === 'dot' || (typeof props.badge === 'number' && props.badge > 0))
</script>

<template>
  <button
    type="button"
    class="liwan-tool"
    data-slide-over-trigger
    :data-variant="props.variant === 'outline' ? 'outline' : undefined"
    :data-open="props.open ? 'true' : undefined"
    :data-mobile="props.hideOnMobile ? 'hide' : undefined"
    :aria-label="props.badge === 'dot' || !hasBadge ? props.label : `${props.label} (${badgeText})`"
    :aria-expanded="props.controls ? !!props.open : undefined"
    :aria-controls="props.controls"
    :aria-haspopup="props.haspopup"
    :title="props.label"
    :disabled="props.disabled"
    @click="emit('click', $event)"
  >
    <UIcon :name="props.icon" class="liwan-shell-icon" aria-hidden="true" />
    <span v-if="hasBadge" class="liwan-tool-badge" :data-testid="props.badgeTestId" :data-dot="props.badge === 'dot' ? 'true' : undefined" dir="ltr" aria-hidden="true">{{ badgeText }}</span>
  </button>
</template>
