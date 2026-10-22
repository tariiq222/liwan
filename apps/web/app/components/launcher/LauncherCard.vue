<script setup lang="ts">
import type { LauncherEntry } from '@/composables/nav/launcherModel'
const props = defineProps<{ entry: LauncherEntry; description?: string }>()
const { t } = useI18n()
const id = useId()
</script>

<template>
  <article data-testid="launcher-card" :data-app="props.entry.id" :aria-labelledby="`${id}-title`" class="flex min-w-0 flex-col gap-(--webvue-gap-card) rounded-card bg-default p-(--webvue-card-pad) ring ring-default">
    <div class="flex min-w-0 items-start gap-3">
      <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true"><UIcon :name="props.entry.icon" class="size-5" /></span>
      <div class="grid min-w-0 flex-1 gap-1">
        <h2 :id="`${id}-title`" class="text-sm font-semibold text-highlighted">{{ t(props.entry.labelKey) }}</h2>
        <p v-if="props.description" class="text-xs leading-relaxed text-muted">{{ props.description }}</p>
      </div>
    </div>
    <div v-if="props.entry.actions.length" class="flex flex-wrap gap-2 border-t border-default pt-3" :aria-label="t('launcher.actions')" data-testid="launcher-actions">
      <UButton v-for="action in props.entry.actions" :key="action.id" :to="{ path: action.to, query: { returnTo: '/apps' } }" :icon="action.icon" size="sm" color="neutral" variant="soft" class="rounded-full" data-testid="launcher-action">{{ t(action.labelKey) }}</UButton>
    </div>
    <div class="mt-auto flex justify-end">
      <UButton :to="props.entry.to" size="sm" class="rounded-full" data-testid="launcher-open" :aria-describedby="`${id}-title`">{{ t('launcher.open') }}<UIcon name="i-lucide-arrow-left" class="size-4 ltr:rotate-180" aria-hidden="true" /></UButton>
    </div>
  </article>
</template>
