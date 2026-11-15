<script setup lang="ts">
import type { SalesCustomerAnswer } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'
import { formatDate } from '@liwan/ui/app/utils/formatDate'

// What the customer did with the quotation sent to them: waiting for an answer, accepted (with the signer's name) or
// declined (with their reason). Shown on the record page once the quotation has been sent.
const props = defineProps<{ answer: SalesCustomerAnswer }>()
const { t } = useI18n()
const outcome = computed(() => props.answer.answer ?? 'waiting')
const TONE: Record<'waiting' | 'accepted' | 'declined', StatusTone> = { waiting: 'info', accepted: 'success', declined: 'destructive' }
</script>

<template>
  <SharedPropertiesPanel :title="t('sales.answer.title')">
    <SharedPropertyRow :label="t('sales.answer.status')">
      <SharedStatusBadge :tone="TONE[outcome]" :label="t(`sales.answer.${outcome}`)" size="sm" data-testid="sales-answer-status" />
    </SharedPropertyRow>
    <SharedPropertyRow :label="t('sales.answer.mode')" :value="t(`sales.answer.modes.${props.answer.mode}`)" />
    <SharedPropertyRow v-if="props.answer.mode !== 'none' && !props.answer.answer" :label="t('sales.answer.afterAcceptance')" :value="t(props.answer.acceptance_confirms ? 'sales.answer.orderConfirmed' : 'sales.answer.youConfirm')" />
    <SharedPropertyRow v-if="props.answer.answered_at" :label="t('sales.answer.answeredAt')" data-testid="sales-answer-at"><bdi dir="ltr">{{ formatDate(props.answer.answered_at) }}</bdi></SharedPropertyRow>
    <SharedPropertyRow v-if="props.answer.signed_by" :label="t('sales.answer.signedBy')" :value="props.answer.signed_by" data-testid="sales-answer-signer" />
    <SharedPropertyRow v-if="props.answer.answer === 'declined'" :label="t('sales.answer.reason')" data-testid="sales-answer-reason">{{ props.answer.decline_reason || t('sales.answer.noReason') }}</SharedPropertyRow>
  </SharedPropertiesPanel>
</template>
