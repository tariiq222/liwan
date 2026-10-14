<script setup lang="ts">
// The one loading placeholder (Tasmim spec §6): rows for lists, a header with a
// properties column for records, a grid of tiles for dashboards. Announced once.
const props = withDefaults(defineProps<{ variant?: 'rows' | 'record' | 'cards'; count?: number }>(), { variant: 'rows', count: 3 })
const { t } = useI18n()
</script>

<template>
  <div role="status" :aria-label="t('app.loading')" data-slot="loading-skeleton" :data-variant="props.variant" class="py-8">
    <span class="sr-only">{{ t('app.loading') }}</span>
    <div v-if="props.variant === 'rows'" class="space-y-3">
      <USkeleton v-for="n in props.count" :key="n" class="h-12" />
    </div>
    <div v-else-if="props.variant === 'record'" class="grid gap-6 lg:grid-cols-3">
      <div class="space-y-3 lg:col-span-2">
        <USkeleton class="h-7 w-1/2" />
        <USkeleton class="h-4 w-3/4" />
        <USkeleton v-for="n in props.count" :key="n" class="h-24" />
      </div>
      <div class="space-y-3">
        <USkeleton v-for="n in 4" :key="n" class="h-6" />
      </div>
    </div>
    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <USkeleton v-for="n in props.count" :key="n" class="h-24" />
    </div>
  </div>
</template>
