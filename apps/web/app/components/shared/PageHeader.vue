<script setup lang="ts">
import { ArrowRight } from '@lucide/vue'
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  title: string
  description?: string
  backTo?: RouteLocationRaw
  backLabel?: string
}>()

usePageHeader(() => props.title, () => props.description)
</script>

<template>
  <header
    data-slot="page-header"
    :data-empty="!(props.backTo || $slots.back || props.description || $slots.actions || $slots.default)"
    class="space-y-3"
  >
    <div v-if="props.backTo || $slots.back" class="flex items-center gap-2 text-sm">
      <slot name="back">
        <NuxtLink :to="props.backTo!" class="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowRight aria-hidden="true" class="size-[18px] ltr:rotate-180" />{{ props.backLabel || $t('app.back') }}
        </NuxtLink>
      </slot>
    </div>

    <span hidden aria-hidden="true"><slot name="title">{{ props.title }}</slot></span>

    <div v-if="props.description || $slots.actions || $slots.default" class="flex flex-wrap items-start justify-between gap-3">
      <p v-if="props.description" class="max-w-3xl text-start text-sm leading-6 text-muted-foreground">{{ props.description }}</p>
      <div v-if="$slots.actions || $slots.default" class="ms-auto flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 sm:w-auto">
        <slot name="actions"><slot /></slot>
      </div>
    </div>
  </header>
</template>
