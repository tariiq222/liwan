<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
defineProps<{ title: string; description?: string; backTo?: string }>()
</script>
<template>
  <header class="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
    <div class="min-w-0 space-y-2">
      <NuxtLink v-if="backTo" :to="backTo" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowRight class="size-4 ltr:rotate-180" />{{ $t('app.back') }}</NuxtLink>
      <h1 class="text-2xl font-semibold tracking-tight">{{ title }}</h1>
      <p v-if="description" class="max-w-2xl text-sm leading-relaxed text-muted-foreground">{{ description }}</p>
    </div>
    <div v-if="$slots.default" class="flex shrink-0 flex-wrap items-center gap-2"><slot /></div>
  </header>
</template>
