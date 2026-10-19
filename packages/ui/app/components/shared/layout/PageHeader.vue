<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

const props = withDefaults(defineProps<{
  title: string
  description?: string
  backTo?: RouteLocationRaw
  backLabel?: string
  /** A frame around the page already shows the heading (the project workspace's h1): draw the actions only. The title still names the page for the shell and `backTo` still answers Escape. */
  hideTitle?: boolean
  /**
   * The heading keeps its place under the floating header while the page scrolls under it
   * (`.webvue-sticky-head` in shell.css). Off where another sticky thing owns that slot: a page frame
   * that already carries the identity band, or a docked `SharedListCard fill` board.
   */
  sticky?: boolean
}>(), { sticky: true })

const { t } = useI18n()
usePageHeader(() => props.title, () => props.description)
// One back rule: the page that supplies a target gets the control, and Escape
// leaves for that same target. useEscapeBack is inert without a target, so the
// keyboard route out and the visible one cannot drift apart. The trail below the
// title shows the same target as its nearest step, so the keyboard route out and
// the visible one still cannot drift apart.
useEscapeBack(() => props.backTo)
// Inside the project workspace the frame is already the page's <h1>.
const frameOwnsHeading = useFrameOwnsHeading()
// The frame's own band is the sticky element there, so this header never claims a second sticky slot.
const stickyHead = computed(() => props.sticky && !frameOwnsHeading.value)

/** One step of the trail under the title: a page the reader came through, with its own link. */
interface HeaderTrailStep { label: string; to?: RouteLocationRaw }

// The trail (DESIGN.md §3) sits under the page title: the ancestors the shell published, then the page's
// own back target as the nearest step. The current page is the title right above, so it is never repeated
// here, and the page's target wins where it names the same step because it carries the list's filters.
const publishedTrail = usePageTrail()
const route = useRoute()
const trail = computed<HeaderTrailStep[]>(() => {
  // The title states the current page, and a step that links to the page the reader is already on
  // says nothing: both go, so a top-level page ends up with no trail at all instead of a self-link.
  const ancestors: HeaderTrailStep[] = publishedTrail.value
    .filter(crumb => crumb.label !== props.title && crumb.to !== route.path)
    .map(crumb => ({ label: crumb.label, to: crumb.to }))
  if (!props.backTo) return ancestors
  const back: HeaderTrailStep = { label: props.backLabel || t('app.back'), to: props.backTo }
  const nearest = ancestors.at(-1)
  return nearest?.label === back.label ? [...ancestors.slice(0, -1), back] : [...ancestors, back]
})
</script>

<template>
  <header
    v-if="!props.hideTitle || $slots.actions || $slots.default"
    data-slot="page-header"
    data-empty="false"
    :data-sticky="stickyHead ? 'true' : undefined"
    class="flex flex-wrap items-center justify-between gap-4"
  >
    <div class="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-4">
      <div v-if="!props.hideTitle" class="min-w-0">
        <h2 v-if="frameOwnsHeading" class="text-xl font-semibold text-highlighted"><slot name="title">{{ props.title }}</slot></h2>
        <h1 v-else class="text-xl font-semibold text-highlighted"><slot name="title">{{ props.title }}</slot></h1>
        <nav v-if="trail.length || $slots.back" data-testid="page-header-trail" :aria-label="$t('nav.breadcrumb')" class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <slot name="back">
            <template v-for="(step, index) in trail" :key="step.label">
              <UIcon v-if="index" name="i-lucide-chevron-left" aria-hidden="true" class="size-3.5 text-dimmed ltr:rotate-180" />
              <UButton v-if="step.to" :to="step.to" color="neutral" variant="link" size="xs" class="p-0 font-medium text-muted hover:text-highlighted focus-visible:ring-2 focus-visible:ring-primary">{{ step.label }}</UButton>
              <span v-else class="text-dimmed">{{ step.label }}</span>
            </template>
          </slot>
        </nav>
        <p v-if="props.description" class="mt-1 max-w-3xl text-start text-sm leading-6 text-muted">{{ props.description }}</p>
      </div>
      <div v-if="$slots.actions || $slots.default" class="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-3">
        <slot name="actions"><slot /></slot>
      </div>
    </div>
  </header>
</template>
