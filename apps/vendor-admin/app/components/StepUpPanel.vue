<script setup lang="ts">
// The step-up confirmation: an inline panel at the top of the page, never a dialog. The browser's
// own passkey prompt is native; this panel says what it is for and offers Retry and Cancel.
const { pending, waiting, error, retry, cancel } = useStepUp()
const { t } = useI18n()
</script>

<template>
  <section
    v-if="pending"
    role="region"
    aria-live="polite"
    :aria-label="t('adminAuth.stepUp.title')"
    data-slot="step-up-panel"
    class="border-b border-default bg-elevated px-4 py-3"
  >
    <div class="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
      <UIcon name="i-lucide-key-round" class="size-5 shrink-0 text-primary" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="font-medium text-highlighted">
          {{ t('adminAuth.stepUp.title') }}
        </p>
        <p v-if="error" class="text-sm text-error" role="alert">
          {{ t(error) }}
        </p>
        <p v-else class="text-sm text-muted">
          {{ t('adminAuth.stepUp.lead') }}
        </p>
      </div>
      <div class="flex gap-2">
        <UButton v-if="waiting" type="button" size="sm" :label="t('adminAuth.stepUp.retry')" @click="retry" />
        <UButton type="button" size="sm" color="neutral" variant="ghost" :label="t('adminAuth.stepUp.cancel')" @click="cancel" />
      </div>
    </div>
  </section>
</template>
