<script setup lang="ts">
// The placeholder of the «ابدأ بالأهم» list while its rows load: five rows of the same height as the real ones, so the
// list does not change height or jump when they arrive. The status text is for assistive technology only.
const { t } = useI18n()
</script>

<template>
  <div role="status" aria-busy="true" :aria-label="t('app.loading')" class="divide-y divide-default overflow-hidden rounded-card border-[1.5px] border-default bg-default" data-testid="home-rail-skeleton">
    <span class="sr-only">{{ t('app.loading') }}</span>
    <div v-for="n in 5" :key="n" class="flex min-h-14 items-center gap-3 px-4 py-2.5" aria-hidden="true">
      <USkeleton class="size-8 shrink-0 rounded-control" />
      <div class="flex-1 space-y-2"><USkeleton class="h-4 w-2/3" /><USkeleton class="h-3 w-1/3" /></div>
      <USkeleton class="h-6 w-16 shrink-0 rounded-control" />
    </div>
  </div>
</template>
