<script setup lang="ts">
// The step-up confirmation: an inline panel pinned to the top of the window (above the shell and over an open
// create panel, whose modal layer would otherwise block its buttons), never a dialog. The browser's
// own passkey prompt is native; this panel says what it is for and offers Retry and Cancel.
const { pending, waiting, error, devEnabled, retry, cancel, confirmWithDev } = useStepUp()
const { t } = useI18n()
// Server markup stays in place; the browser moves the panel to the body once mounted.
const teleported = ref(false)
onMounted(() => { teleported.value = true })
</script>

<template>
  <!-- On the body, outside the app's stacking context: a modal layer (the create panel) sits above the
       app root and hides it from assistive technology, and the confirmation must stay usable over it. -->
  <Teleport to="body" :disabled="!teleported">
    <section
      v-if="pending"
      role="region"
      aria-live="polite"
      :aria-label="t('adminAuth.stepUp.title')"
      data-slot="step-up-panel"
      class="pointer-events-auto fixed inset-x-0 top-0 z-[200] border-b border-default bg-elevated px-4 py-3 shadow-md"
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
          <UButton v-if="devEnabled" type="button" size="sm" color="warning" variant="soft" :label="t('adminAuth.stepUp.devConfirm')" @click="confirmWithDev" />
          <UButton v-if="waiting" type="button" size="sm" :label="t('adminAuth.stepUp.retry')" @click="retry" />
          <UButton type="button" size="sm" color="neutral" variant="ghost" :label="t('adminAuth.stepUp.cancel')" @click="cancel" />
        </div>
      </div>
    </section>
  </Teleport>
</template>
