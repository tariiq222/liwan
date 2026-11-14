<script setup lang="ts">
import { cardExpiryLabel, maskedCardNumber, savedCardState, type SavedCard } from '@liwan/commercial-ui/app/utils/paymentMethod'
const props = defineProps<{ card: SavedCard | null; autoRenew: boolean; now?: Date }>()
const { t, te } = useI18n()
const state = computed(() => (props.card ? savedCardState(props.card, props.now ?? new Date()) : null))
const TONE = { active: 'success', inactive: 'warning', expired: 'destructive' } as const
const brand = computed(() => (props.card ? (te(`subscription.paymentMethod.brands.${props.card.brand}`) ? t(`subscription.paymentMethod.brands.${props.card.brand}`) : props.card.brand) : ''))
const hint = computed(() => (props.autoRenew ? 'subscription.paymentMethod.chargedToCard' : 'subscription.paymentMethod.paidManually'))
</script>
<template>
  <div class="space-y-4" data-slot="payment-method">
    <div v-if="card && state" class="space-y-2" data-slot="saved-card">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="font-medium text-highlighted">{{ brand }} <bdi dir="ltr" class="tabular-nums" data-slot="card-number">{{ maskedCardNumber(card) }}</bdi></p>
        <SharedStatusBadge data-slot="card-state" :data-state="state" :tone="TONE[state]" :label="t(`subscription.paymentMethod.state.${state}`)" />
      </div>
      <p class="text-sm text-muted">{{ t('subscription.paymentMethod.expires') }} <bdi dir="ltr" class="tabular-nums" data-slot="card-expiry">{{ cardExpiryLabel(card) }}</bdi></p>
      <p v-if="state !== 'active'" class="text-sm text-muted" data-slot="card-state-hint">{{ t(`subscription.paymentMethod.stateHint.${state}`) }}</p>
    </div>
    <div v-else class="space-y-1" data-slot="no-card">
      <p class="font-medium text-highlighted">{{ t('subscription.paymentMethod.none') }}</p>
      <p class="text-sm text-muted">{{ t('subscription.paymentMethod.noneHint') }}</p>
    </div>
    <p v-if="card" class="text-sm text-muted" data-slot="renewal-hint">{{ t(hint) }}</p>
    <slot />
  </div>
</template>
