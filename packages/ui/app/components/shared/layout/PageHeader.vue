<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { PageHeaderTag } from '../../../utils/pageHeaderTag'

const props = defineProps<{
  title: string
  /** Replaces the icon the shell publishes for the current application (the tile keeps the application colour). */
  icon?: string
  /** The one line under the title; without it the shell's tagline for the current application is shown. */
  description?: string
  /** Short facts about the page's subject (state, owner, count), drawn inline after the title; a tag with `to` is a link. */
  tags?: PageHeaderTag[]
  backTo?: RouteLocationRaw
  backLabel?: string
  /** A frame around the page already shows the heading (the project workspace's h1): draw the actions only. The title still names the page for the shell and `backTo` still answers Escape. */
  hideTitle?: boolean
  /** The page carries a KPI strip: draw the one show/hide toggle for it before the actions (DESIGN.md; the choice is `useKpiVisibility`). */
  kpiToggle?: boolean
}>()

const { t } = useI18n()
usePageHeader(() => props.title)
// One back rule: the page that supplies a target gets the control, and Escape
// leaves for that same target. useEscapeBack is inert without a target, so the
// keyboard route out and the visible one cannot drift apart. The trail below the
// title shows the same target as its nearest step, so the keyboard route out and
// the visible one still cannot drift apart.
useEscapeBack(() => props.backTo)
// The 64px tile before the title: the icon of the application the shell published, or the `icon` override, in the application colour.
// Outside a shell (vendor-admin) nothing is published, so a header without an `icon` draws no tile.
const pageApp = usePageApp()
const chip = computed(() => {
  return props.icon ?? pageApp.value?.icon
})
const tagline = computed(() => props.description ?? pageApp.value?.tagline)
// Inside the project workspace the frame is already the page's <h1>.
const frameOwnsHeading = useFrameOwnsHeading()

/** One step of the trail under the title: a page the reader came through, with its own link. */
interface HeaderTrailStep { label: string; to?: RouteLocationRaw }

// The trail (DESIGN.md §3) sits above the page title: the ancestors the shell published, then the page's
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
    v-if="!props.hideTitle || $slots.actions || $slots.default || $slots.tabs || props.kpiToggle"
    data-slot="page-header"
    data-empty="false"
    class="min-w-0"
    :class="props.hideTitle ? 'flex flex-wrap items-center justify-end gap-3' : ['grid gap-3 border-b border-default', $slots.tabs ? 'pb-0' : 'pb-5']"
  >
    <template v-if="!props.hideTitle">
      <div v-if="trail.length || $slots.back" class="flex min-w-0 items-center gap-x-2 text-[13px]/5 text-muted">
        <!-- A long trail at the large text size wraps instead of widening the page. -->
        <nav data-testid="page-header-trail" :aria-label="$t('nav.breadcrumb')" class="flex min-w-0 flex-wrap items-center gap-x-1.5">
          <slot name="back">
            <template v-for="(step, index) in trail" :key="step.label">
              <UIcon v-if="index" name="i-lucide-chevron-left" aria-hidden="true" class="size-3.5 text-dimmed ltr:rotate-180" />
              <UButton v-if="step.to" :to="step.to" color="neutral" variant="link" size="xs" class="p-0 font-medium text-muted hover:text-highlighted focus-visible:ring-2 focus-visible:ring-primary">{{ step.label }}</UButton>
              <span v-else class="text-dimmed">{{ step.label }}</span>
            </template>
          </slot>
        </nav>
      </div>
      <div data-slot="page-header-row" class="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span
          v-if="chip"
          data-slot="page-header-chip"
          aria-hidden="true"
          class="liwan-app-tile liwan-app-tile-lg grid shrink-0 place-items-center"
          :data-app="pageApp?.id"
        ><UIcon :name="chip" class="size-[30px]!" /></span>
        <div class="min-w-0 flex-1 basis-60">
          <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 v-if="frameOwnsHeading" class="min-w-0 font-display text-[length:clamp(28px,3.2vw,38px)]/[1.15] font-bold tracking-[-0.01em] text-highlighted"><slot name="title">{{ props.title }}</slot></h2>
            <h1 v-else class="min-w-0 font-display text-[length:clamp(28px,3.2vw,38px)]/[1.15] font-bold tracking-[-0.01em] text-highlighted"><slot name="title">{{ props.title }}</slot></h1>
            <slot name="tags">
              <SharedHeaderTags :tags="props.tags" />
            </slot>
          </div>
          <p v-if="tagline" data-slot="page-header-tagline" class="mt-1 text-[15px] text-toned">{{ tagline }}</p>
        </div>
        <div v-if="$slots.actions || $slots.default || props.kpiToggle" class="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-2.5 pointer-coarse:*:min-h-11">
          <SharedKpiToggle v-if="props.kpiToggle" />
          <slot name="actions"><slot /></slot>
        </div>
      </div>
    </template>
    <div v-else-if="$slots.actions || $slots.default || props.kpiToggle" class="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-2.5 pointer-coarse:*:min-h-11">
      <SharedKpiToggle v-if="props.kpiToggle" />
      <slot name="actions"><slot /></slot>
    </div>
    <!-- The header's own bottom border is the tabs' 1px divider, so the strip inside draws none. -->
    <div v-if="$slots.tabs" data-slot="page-header-tabs" class="min-w-0" :class="props.hideTitle ? 'basis-full' : 'mt-3 [&_[data-slot=route-tabs-frame]]:border-b-0'"><slot name="tabs" /></div>
  </header>
</template>
