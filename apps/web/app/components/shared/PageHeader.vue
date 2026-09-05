<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  title: string
  description?: string
  backTo?: RouteLocationRaw
  backLabel?: string
}>()
</script>

<template>
  <header class="space-y-3">
    <div v-if="props.backTo || $slots.back" class="flex items-center gap-2 text-sm">
      <slot name="back">
        <NuxtLink :to="props.backTo!" class="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline">
          <ArrowRight aria-hidden="true" class="size-4 ltr:rotate-180" />{{ props.backLabel || $t('app.back') }}
        </NuxtLink>
      </slot>
    </div>

    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 text-start">
        <h1 class="text-2xl font-semibold">
          <slot name="title">{{ props.title }}</slot>
        </h1>
        <p v-if="props.description" class="mt-1 text-sm text-muted-foreground">{{ props.description }}</p>
      </div>
      <div v-if="$slots.actions || $slots.default" class="ms-auto flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 sm:w-auto">
        <slot name="actions"><slot /></slot>
      </div>
    </div>
  </header>
</template>
