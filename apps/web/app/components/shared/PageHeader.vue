<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  title: string
  description?: string
  backTo?: RouteLocationRaw
  backLabel?: string
}>()

usePageHeader(() => props.title, () => props.description)
// One back rule: the page that supplies a target gets the control, and Escape
// leaves for that same target. useEscapeBack is inert without a target, so the
// keyboard route out and the visible one cannot drift apart. The old
// suppression list existed only to stop the header repeating shell context the
// breadcrumb already showed; the breadcrumb is gone and the project frame owns
// the project name, so there is nothing left to suppress.
useEscapeBack(() => props.backTo)
// Inside the project workspace the frame is already the page's <h1>.
const frameOwnsHeading = useProjectFrameHeading()
</script>

<template>
  <header
    data-slot="page-header"
    data-empty="false"
    class="flex flex-wrap items-center justify-between gap-4"
  >
    <div class="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <div v-if="props.backTo || $slots.back" class="mb-1 flex items-center gap-2 text-sm">
          <slot name="back">
            <UButton :to="props.backTo!" color="neutral" variant="outline" class="focus-visible:ring-2 focus-visible:ring-primary">
              <UIcon name="i-lucide-arrow-right" aria-hidden="true" class="size-4.5 ltr:rotate-180" />{{ props.backLabel || $t('app.back') }}
            </UButton>
          </slot>
        </div>
        <h2 v-if="frameOwnsHeading" class="text-xl font-semibold text-highlighted"><slot name="title">{{ props.title }}</slot></h2>
        <h1 v-else class="text-xl font-semibold text-highlighted"><slot name="title">{{ props.title }}</slot></h1>
        <p v-if="props.description" class="mt-1 max-w-3xl text-start text-sm leading-6 text-muted">{{ props.description }}</p>
      </div>
      <div v-if="$slots.actions || $slots.default" class="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-3">
        <slot name="actions"><slot /></slot>
      </div>
    </div>
  </header>
</template>
