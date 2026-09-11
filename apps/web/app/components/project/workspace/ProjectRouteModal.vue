<script setup lang="ts">
import type { SlideoverProps } from '@nuxt/ui'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { PROJECT_OVERLAY_INJECTION_KEY } from '@/utils/projectOverlayRoute'
import { workspaceOverlayTitleKey } from '@/utils/workspacePresentation'

const props = defineProps<{
  route: RouteLocationNormalizedLoaded
  open: boolean
  frameStyle: Record<string, string>
  sheetWidth: string
  side: 'left' | 'right'
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
  hash: props.route.hash,
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

const dialogContent = computed<NonNullable<SlideoverProps['content']> & { style: import('vue').CSSProperties }>(() => ({
  style: {
    width: props.sheetWidth,
    position: 'absolute',
    maxWidth: '100%',
    insetBlock: '0',
    insetInlineStart: 'auto',
    insetInlineEnd: '0',
  },
  onEscapeKeyDown: closeOnEscape,
  onInteractOutside: keepOpen,
  onPointerDownOutside: keepOpen,
}))
</script>

<template>
  <Teleport to="body">
    <div data-project-overlay data-testid="project-route-overlay" class="pointer-events-none fixed z-[60] overflow-hidden" :style="props.frameStyle">
      <Transition name="project-sheet-backdrop" appear>
        <div v-if="props.open" data-testid="project-sheet-backdrop" aria-hidden="true" class="project-sheet-backdrop pointer-events-none absolute inset-0" />
      </Transition>
      <USlideover :open="props.open" :modal="false" :portal="false" :overlay="false" :close="false" :transition="false"
        :side="props.side"
        :title="t(workspaceOverlayTitleKey(props.route.path))" :description="t(workspaceOverlayTitleKey(props.route.path))"
        :content="dialogContent"
        :ui="{ content: 'nasq-ui-route-sheet pointer-events-auto rounded-none', body: 'min-h-0 flex-1 overflow-y-auto p-0' }"
        @update:open="open => { if (!open && props.open) emit('close') }" @after:leave="emit('afterLeave')">
        <template #content>
          <div class="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-default px-4 md:px-6">
            <UButton :to="fullPageTo" color="neutral" data-testid="project-overlay-full-page" variant="outline">{{ t('projects.workspace.openFullPage') }}</UButton>
            <UButton type="button" color="neutral" square icon="i-lucide-x" data-testid="project-overlay-close" :aria-label="t('projects.workspace.close')" @click="emit('close')" variant="outline" />
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <div class="flex min-h-full flex-col gap-5 px-4 py-4 md:gap-6 md:px-6 md:py-6">
              <NuxtPage :route="props.route" :page-key="pageKey" />
            </div>
          </div>
        </template>
      </USlideover>
    </div>
  </Teleport>
</template>
