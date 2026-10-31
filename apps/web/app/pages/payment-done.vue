<script setup lang="ts">
// The landing after a prospect pays its first order on the LiwanOS domain: there is no workspace and no session yet,
// so nothing here reads an account. The result is only what the payment return relay verified with the provider.
definePageMeta({ layout: false, access: 'public' })

const { t } = useI18n()
const route = useRoute()
const result = computed(() => (route.query.result === 'paid' || route.query.result === 'failed' ? route.query.result : 'pending'))
const color = { paid: 'success', failed: 'error', pending: 'info' } as const
const icon = { paid: 'i-lucide-circle-check', failed: 'i-lucide-circle-x', pending: 'i-lucide-clock' } as const
</script>

<template>
  <SharedStandalonePage>
    <template #header>
      <div class="flex flex-col items-center text-center">
        <p class="text-sm text-muted">{{ t('app.productName') }}</p>
        <h1 class="mt-1 text-xl font-semibold text-highlighted">{{ t('subscription.paymentDone.title') }}</h1>
      </div>
    </template>
    <UAlert role="status" :color="color[result]" variant="subtle" :icon="icon[result]" :title="t(`subscription.paymentDone.${result}.title`)" :description="t(`subscription.paymentDone.${result}.body`)" data-testid="payment-done" />
  </SharedStandalonePage>
</template>
