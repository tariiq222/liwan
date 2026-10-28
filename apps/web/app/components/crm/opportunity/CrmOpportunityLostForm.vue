<script setup lang="ts">
import type { CrmLostReason } from '@webvue/contracts'

// Closing an opportunity as lost: the reason, then an inline confirmation (never a dialog).
defineProps<{ reasons: CrmLostReason[]; pending?: boolean; error?: string }>()
const emit = defineEmits<{ confirm: [lostReasonId: number]; cancel: [] }>()
const { t } = useI18n()
const reasonId = ref<number | undefined>()
const attempted = ref(false)

function submit() {
  attempted.value = true
  if (reasonId.value) emit('confirm', reasonId.value)
}
</script>

<template>
  <SharedInlineConfirm :title="t('crm.opportunities.lost.confirmTitle')" :description="t('crm.opportunities.lost.confirmBody')" :confirm-label="t('crm.opportunities.lost.confirm')" :pending="pending" @confirm="submit" @cancel="emit('cancel')">
    <UFormField class="mt-3" :label="t('crm.opportunities.lost.reason')" name="lost-reason" required :error="attempted && !reasonId ? t('crm.opportunities.lost.reasonRequired') : undefined">
      <USelect id="lost-reason" v-model="reasonId" class="w-full" :items="reasons.map(reason => ({ value: reason.id, label: reason.name }))" :placeholder="t('crm.opportunities.lost.reasonPlaceholder')" :disabled="pending" />
    </UFormField>
    <p v-if="error" role="alert" class="mt-2 text-sm text-error">{{ error }}</p>
  </SharedInlineConfirm>
</template>
