<script setup lang="ts">
// The inline confirmation that withdraws a warning. The reason is required: the server keeps it on the record.
const props = defineProps<{ pending?: boolean }>()
const emit = defineEmits<{ confirm: [reason: string]; cancel: [] }>()
const { t } = useI18n()
const reason = ref('')
const missing = computed(() => !reason.value.trim())
</script>

<template>
  <SharedInlineConfirm
    :title="t('hrWarnings.actions.withdrawTitle')"
    :description="t('hrWarnings.actions.withdrawHint')"
    :confirm-label="t('hrWarnings.actions.withdraw')"
    :cancel-label="t('app.back')"
    :pending="props.pending"
    :disabled="missing"
    @confirm="!missing && emit('confirm', reason.trim())"
    @cancel="emit('cancel')"
  >
    <UFormField :label="t('hrWarnings.actions.withdrawReasonRequired')" for="hr-warning-withdraw-reason" class="mt-2">
      <UTextarea id="hr-warning-withdraw-reason" v-model="reason" class="w-full" :rows="2" :disabled="props.pending" data-testid="hr-warning-withdraw-reason" />
    </UFormField>
  </SharedInlineConfirm>
</template>
