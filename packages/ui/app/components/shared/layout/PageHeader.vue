<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { PageHeaderTag } from '../../../utils/pageHeaderTag'

const props = withDefaults(defineProps<{
  title: string
  description?: string
  /** Replaces the icon the shell publishes for the current application (the chip keeps the brand colour). */
  icon?: string
  /** Short facts about the page's subject (state, owner, count), drawn inline after the title; a tag with `to` is a link. */
  tags?: PageHeaderTag[]
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
  /** The page carries a KPI strip: draw the one show/hide toggle for it before the actions (DESIGN.md; the choice is `useKpiVisibility`). */
  kpiToggle?: boolean
}>(), { sticky: true })

const { t } = useI18n()
usePageHeader(() => props.title, () => props.description)
// One back rule: the page that supplies a target gets the control, and Escape
// leaves for that same target. useEscapeBack is inert without a target, so the
// keyboard route out and the visible one cannot drift apart. The trail below the
// title shows the same target as its nearest step, so the keyboard route out and
// the visible one still cannot drift apart.
useEscapeBack(() => props.backTo)
// The chip before the title: the icon of the application the shell published, or the `icon` override, in the brand colour for every application.
// Outside a shell (vendor-admin) nothing is published, so a header without an `icon` draws no chip.
const pageApp = usePageApp()
const chip = computed(() => {
  return props.icon ?? pageApp.value?.icon
})
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
  // The title states the current page, so a step with its name goes; a step that points at the page the
  // reader is on stays as plain text. A page with no ancestor still starts with its application, so every
  // header shows where it sits.
  const published: HeaderTrailStep[] = publishedTrail.value
    .filter(crumb => crumb.label !== props.title)
    .map(crumb => ({ label: crumb.label, to: crumb.to === route.path ? undefined : crumb.to }))
  const app = pageApp.value
  const ancestors = published.length || !app?.label || app.label === props.title
    ? published
    : [{ label: app.label, to: app.to === route.path ? undefined : app.to }]
  if (!props.backTo) return ancestors
  const back: HeaderTrailStep = { label: props.backLabel || t('app.back'), to: props.backTo }
  const nearest = ancestors.at(-1)
  return nearest?.label === back.label ? [...ancestors.slice(0, -1), back] : [...ancestors, back]
})
</script>

<template>
  <header
    v-if="!props.hideTitle || $slots.actions || $slots.default || props.kpiToggle"
    data-slot="page-header"
    data-empty="false"
    :data-sticky="stickyHead ? 'true' : undefined"
    class="flex flex-wrap items-center gap-x-3.5 gap-y-2"
    :class="{ 'rounded-card bg-default px-4 py-3 ring ring-default': !props.hideTitle }"
  >
    <template v-if="!props.hideTitle">
      <span
        v-if="chip"
        data-slot="page-header-chip"
        aria-hidden="true"
        class="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
      ><UIcon :name="chip" class="size-5" /></span>
      <div class="min-w-0 flex-1 basis-40">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2 v-if="frameOwnsHeading" class="min-w-0 text-lg/7 font-semibold text-highlighted"><slot name="title">{{ props.title }}</slot></h2>
          <h1 v-else class="min-w-0 text-lg/7 font-semibold text-highlighted"><slot name="title">{{ props.title }}</slot></h1>
          <slot name="tags">
            <SharedHeaderTags :tags="props.tags" />
          </slot>
        </div>
        <div v-if="trail.length || $slots.back || props.description" class="mt-0.5 flex min-w-0 items-center gap-x-2 text-xs/5 text-muted">
          <nav v-if="trail.length || $slots.back" data-testid="page-header-trail" :aria-label="$t('nav.breadcrumb')" class="flex shrink-0 items-center gap-1.5">
            <slot name="back">
              <template v-for="(step, index) in trail" :key="step.label">
                <UIcon v-if="index" name="i-lucide-chevron-left" aria-hidden="true" class="size-3.5 text-dimmed ltr:rotate-180" />
                <UButton v-if="step.to" :to="step.to" color="neutral" variant="link" size="xs" class="p-0 font-medium text-muted hover:text-highlighted focus-visible:ring-2 focus-visible:ring-primary">{{ step.label }}</UButton>
                <span v-else class="text-dimmed">{{ step.label }}</span>
              </template>
            </slot>
          </nav>
          <span v-if="(trail.length || $slots.back) && props.description" aria-hidden="true" class="text-dimmed">·</span>
          <p v-if="props.description" class="min-w-0 truncate text-start" :title="props.description">{{ props.description }}</p>
        </div>
      </div>
    </template>
    <div v-if="$slots.actions || $slots.default || props.kpiToggle" class="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-3">
      <SharedKpiToggle v-if="props.kpiToggle" />
      <slot name="actions"><slot /></slot>
    </div>
  </header>
</template>
