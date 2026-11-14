<script setup lang="ts">
import type { SubscriptionCancellation } from '@liwan/commercial-contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { dayBefore } from '@/utils/subscription'
const props = defineProps<{ cancellation: SubscriptionCancellation | null; cancellable: boolean; renewalOn: string | null; canManage: boolean; pending?: boolean; hydrated?: boolean; error?: string }>()
const emit = defineEmits<{ cancel: [reason: string | undefined]; resume: [] }>()
const { t } = useI18n()
const confirming = ref(false)
const reason = ref('')
const effectiveOn = computed(() => props.cancellation?.effective_on ?? props.renewalOn)
const endDate = computed(() => formatDate(effectiveOn.value, 'Asia/Riyadh'))
const lastDay = computed(() => (effectiveOn.value ? formatDate(dayBefore(effectiveOn.value), 'Asia/Riyadh') : ''))
const blocked = computed(() => props.pending || props.hydrated === false)
function submitCancel() { emit('cancel', reason.value.trim() || undefined); confirming.value = false; reason.value = '' }
</script>
<template>
  <div class="space-y-3" data-slot="cancel-panel">
    <template v-if="cancellation">
      <p class="text-sm text-muted">{{ t(`subscription.cancel.requestedBy.${cancellation.requested_by}`, { date: formatDate(cancellation.requested_at, 'Asia/Riyadh') }) }}</p>
      <p v-if="!canManage" class="text-sm text-muted">{{ t('subscription.cancel.readOnly') }}</p>
      <UButton v-else :disabled="blocked" :loading="pending" @click="emit('resume')">{{ t('subscription.cancel.resume') }}</UButton>
    </template>
    <template v-else-if="cancellable">
      <p class="text-sm text-muted">{{ t('subscription.cancel.intro', { date: endDate }) }}</p>
      <p v-if="!canManage" class="text-sm text-muted">{{ t('subscription.cancel.readOnly') }}</p>
      <UButton v-else-if="!confirming" color="neutral" variant="outline" :disabled="blocked" @click="confirming = true">{{ t('subscription.cancel.open') }}</UButton>
      <div v-else class="space-y-3" role="group" :aria-label="t('subscription.cancel.confirmTitle')" data-slot="cancel-confirm">
        <p class="font-medium">{{ t('subscription.cancel.confirmTitle') }}</p>
        <ul class="list-disc space-y-1 ps-5 text-sm">
          <li>{{ t('subscription.cancel.keeps', { lastDay }) }}</li>
          <li>{{ t('subscription.cancel.after', { date: endDate }) }}</li>
          <li>{{ t('subscription.cancel.noRefund') }}</li>
          <li>{{ t('subscription.cancel.resumeAnytime', { date: endDate }) }}</li>
        </ul>
        <UFormField :label="t('subscription.cancel.reasonLabel')"><UTextarea v-model="reason" :maxlength="1000" :rows="2" class="w-full" /></UFormField>
        <div class="flex flex-wrap gap-2">
          <UButton color="error" :disabled="blocked" :loading="pending" @click="submitCancel">{{ t('subscription.cancel.confirm') }}</UButton>
          <UButton color="neutral" variant="outline" :disabled="pending" @click="confirming = false">{{ t('subscription.cancel.keep') }}</UButton>
        </div>
      </div>
    </template>
    <UAlert v-if="error" color="error" variant="subtle" role="alert" :title="error" />
  </div>
</template>
