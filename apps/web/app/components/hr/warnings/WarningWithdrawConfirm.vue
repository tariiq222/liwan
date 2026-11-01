<script setup lang="ts">
// The inline confirmation that withdraws a warning, or discards a draft. The reason is required: the server keeps it on the record.
const props = defineProps<{ draft?: boolean; pending?: boolean }>()
const emit = defineEmits<{ confirm: [reason: string]; cancel: [] }>()
const { t } = useI18n()
const reason = ref('')
const missing = computed(() => !reason.value.trim())
</script>

<template>
  <SharedInlineConfirm
    :title="t(props.draft ? 'hrWarnings.actions.discardTitle' : 'hrWarnings.actions.withdrawTitle')"
    :description="t(props.draft ? 'hrWarnings.actions.discardHint' : 'hrWarnings.actions.withdrawHint')"
    :confirm-label="t(props.draft ? 'hrWarnings.actions.discard' : 'hrWarnings.actions.withdraw')"
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
