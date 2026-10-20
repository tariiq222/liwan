<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

// A settings card that previews the latest rows of a long list (no filters) and ends with a link to the full list page.
defineProps<{ title: string; allLabel: string; allTo: RouteLocationRaw; testId?: string }>()
const { t } = useI18n()
</script>

<template>
  <SharedRecordSection variant="list" :title="title" :description="t('settings.preview.latest')" :data-testid="testId">
    <slot />
    <div class="flex justify-end px-(--webvue-card-pad) py-3">
      <NuxtLink :to="allTo" class="inline-flex items-center gap-1 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none">
        {{ allLabel }}
        <UIcon name="i-lucide-chevron-left" class="size-4 rtl:rotate-180" aria-hidden="true" />
      </NuxtLink>
    </div>
  </SharedRecordSection>
</template>
