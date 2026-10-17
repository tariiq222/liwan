<script setup lang="ts">
// The caller lacks the capability (403). There is nothing to retry; the line under the title says what to do.
const props = defineProps<{ description?: string }>()
const { t } = useI18n()
</script>

<template>
  <div role="alert" data-slot="forbidden-state" class="flex flex-col items-center gap-3 rounded-card border border-dashed border-default px-6 py-10 text-center">
    <UIcon name="i-lucide-lock" class="size-6 text-muted" aria-hidden="true" />
    <p class="font-medium text-highlighted">{{ t('errors.forbidden') }}</p>
    <p class="max-w-prose text-sm text-muted">{{ props.description ?? t('states.forbiddenHint') }}</p>
  </div>
</template>
