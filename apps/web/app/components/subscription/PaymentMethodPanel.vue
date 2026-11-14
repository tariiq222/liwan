<script setup lang="ts">
import { cardExpiryLabel, maskedCardNumber, savedCardState, type SavedCard } from '@liwan/commercial-ui/app/utils/paymentMethod'
const props = defineProps<{ card: SavedCard | null; autoRenew: boolean; now?: Date; canManage?: boolean; pending?: boolean; hydrated?: boolean; removeFailure?: 'not_removed' | 'failed' | null }>()
const emit = defineEmits<{ remove: [] }>()
const confirming = ref(false)
function confirmRemove() { emit('remove'); confirming.value = false }
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
    <div v-if="card && canManage" class="space-y-2" data-slot="remove-card">
      <UAlert v-if="removeFailure" color="error" variant="subtle" role="alert" data-testid="remove-card-failed" :title="t(`subscription.paymentMethod.remove.${removeFailure}`)" />
      <SharedInlineConfirm v-if="confirming" :title="t('subscription.paymentMethod.remove.title')" :description="t(autoRenew ? 'subscription.paymentMethod.remove.descriptionAutoRenew' : 'subscription.paymentMethod.remove.description')" :confirm-label="t('subscription.paymentMethod.remove.confirm')" :pending="pending" :disabled="hydrated === false || pending" @confirm="confirmRemove" @cancel="confirming = false" />
      <UButton v-else color="error" variant="outline" size="sm" icon="i-lucide-trash-2" data-testid="remove-card" :disabled="hydrated === false || pending" @click="confirming = true">{{ t('subscription.paymentMethod.remove.action') }}</UButton>
    </div>
    <slot />
  </div>
</template>
