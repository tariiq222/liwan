<script setup lang="ts">
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import {
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { PROJECT_OVERLAY_INJECTION_KEY } from '@/utils/projectOverlayRoute'

const props = defineProps<{
  route: RouteLocationNormalizedLoaded
  open: boolean
  frameStyle: Record<string, string>
  sheetWidth: string
}>()
const emit = defineEmits<{ close: []; afterLeave: [] }>()
const { t } = useI18n()
provide(PROJECT_OVERLAY_INJECTION_KEY, true)

// Keep the page instance alive for query-only updates so route guards in a
// dirty form still observe the update. A path change intentionally replaces
// the workflow content inside the same dialog.
const pageKey = computed(() => `project-overlay:${props.route.path}`)
const fullPageTo = computed(() => ({
  path: props.route.path,
  query: { ...props.route.query, fullPage: '1' },
}))

function keepOpen(event: Event) {
  // Shell links remain usable with a non-modal dialog, while the project
  // overlay itself is closed only by its explicit close action or Escape.
  event.preventDefault()
}

function closeOnEscape(event: Event) {
  event.preventDefault()
  emit('close')
}
</script>

<template>
  <DialogRoot :open="props.open" :modal="false" :unmount-on-hide="false" @update:open="open => { if (!open && props.open) emit('close') }">
    <DialogPortal :force-mount="true">
      <div
        data-project-overlay
        data-testid="project-route-overlay"
        class="pointer-events-none fixed z-[50] overflow-hidden"
        :style="props.frameStyle"
      >
        <Transition name="project-sheet-backdrop" appear>
          <div
            v-if="props.open"
            data-testid="project-sheet-backdrop"
            aria-hidden="true"
            class="project-sheet-backdrop pointer-events-none absolute inset-0"
          />
        </Transition>
        <Transition
          appear
          enter-active-class="project-overlay-transition transition-transform duration-200 ease-out motion-reduce:duration-0"
          enter-from-class="project-overlay-enter-from"
          enter-to-class="translate-x-0"
          leave-active-class="project-overlay-transition transition-transform duration-180 ease-in motion-reduce:duration-0"
          leave-from-class="translate-x-0"
          leave-to-class="project-overlay-leave-to"
          @after-leave="emit('afterLeave')"
        >
          <DialogContent
            v-if="props.open"
            force-mount
            :style="{ width: props.sheetWidth, 'border-start-start-radius': 'inherit' }"
            class="pointer-events-auto absolute inset-y-0 start-0 flex max-w-full min-h-0 flex-col gap-0 overflow-hidden rounded-none border border-border bg-background p-0 shadow-xl"
            @escape-key-down="closeOnEscape"
            @interact-outside="keepOpen"
            @pointer-down-outside="keepOpen"
          >
          <DialogTitle class="sr-only">{{ t('projects.title') }}</DialogTitle>
          <DialogDescription class="sr-only">{{ t('projects.title') }}</DialogDescription>
            <div class="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4 md:px-6">
              <NuxtLink
                :to="fullPageTo"
                class="inline-flex min-h-9 items-center rounded-lg px-3 text-sm text-muted-foreground underline-offset-4 transition-colors hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="project-overlay-full-page"
              >
                {{ t('projects.workspace.openFullPage') }}
              </NuxtLink>
              <button
                type="button"
                class="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="project-overlay-close"
                :aria-label="t('projects.workspace.close')"
                @click="emit('close')"
              >
                <span aria-hidden="true" class="text-xl leading-none">×</span>
              </button>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <div class="flex min-h-full flex-col gap-5 px-4 py-4 md:gap-6 md:px-6 md:py-6">
                <NuxtPage :route="props.route" :page-key="pageKey" />
              </div>
            </div>
          </DialogContent>
        </Transition>
      </div>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.project-sheet-backdrop {
  background: rgb(0 0 0 / 20%);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.project-sheet-backdrop-enter-active,
.project-sheet-backdrop-leave-active { transition: opacity 180ms ease; }
.project-sheet-backdrop-enter-from,
.project-sheet-backdrop-leave-to { opacity: 0; }

:global(.project-overlay-leave-to) {
  transform: translateX(var(--project-overlay-travel, 100vw));
}

:global(.project-overlay-enter-from) {
  transform: translateX(var(--project-overlay-travel, 100vw));
}

@media (prefers-reduced-motion: reduce) {
  .project-sheet-backdrop-enter-active,
  .project-sheet-backdrop-leave-active { transition: none; }

  :global(.project-overlay-leave-to),
  :global(.project-overlay-transition) {
    transition-duration: 0s !important;
  }
}
</style>
