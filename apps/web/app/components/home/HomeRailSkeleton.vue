<script setup lang="ts">
// The placeholder of a home rail while its cards load: cards of the same width and gap, so the rail does not change
// height or jump when the real cards arrive. The status text is for assistive technology only.
const { t } = useI18n()
</script>

<template>
  <div role="status" aria-busy="true" :aria-label="t('app.loading')" class="-mx-1.5 -mb-5 -mt-4 flex gap-4 overflow-hidden px-1.5 pb-10 pt-4" data-testid="home-rail-skeleton">
    <span class="sr-only">{{ t('app.loading') }}</span>
    <USkeleton v-for="n in 3" :key="n" class="h-[11.5rem] w-[300px] shrink-0 rounded-card" aria-hidden="true" />
  </div>
</template>
