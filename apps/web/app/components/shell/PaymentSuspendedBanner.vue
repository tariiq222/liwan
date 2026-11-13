<script setup lang="ts">
// Shown to every signed-in user while the tenant is suspended for an unpaid invoice: the workspace is read-only, and
// whoever holds `subscription.manage` can go straight to payment.
defineProps<{ canPay: boolean }>()
const { t } = useI18n()
</script>

<template>
  <UAlert
    data-testid="payment-suspended-banner"
    role="status"
    color="warning"
    variant="subtle"
    icon="i-lucide-lock"
    :title="t('subscription.suspended.title')"
    :description="t(canPay ? 'subscription.suspended.description' : 'subscription.suspended.descriptionMember')"
    :actions="canPay ? [{ label: t('subscription.suspended.pay'), to: '/subscription', color: 'warning', variant: 'solid' }] : undefined"
  />
</template>
