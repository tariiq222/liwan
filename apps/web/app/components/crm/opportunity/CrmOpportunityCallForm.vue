<script setup lang="ts">
import type { CrmLostReason, CrmOutcome, CrmPackage } from '@webvue/contracts'
import CrmOpportunitySaleForm, { type CrmSaleDraft } from './CrmOpportunitySaleForm.vue'

export interface CrmCallDraft {
  outcome_id: number
  note?: string
  duration_minutes?: number
  package_id?: number
  final_price?: number
  lost_reason_id?: number
}

// Record one call. The outcome decides the rest: a sold outcome opens the sale fields, a losing outcome that carries
// no reason asks for one, which goes with the call: one request logs the call and closes the opportunity as lost.
const props = defineProps<{ outcomes: CrmOutcome[]; packages: CrmPackage[]; lostReasons: CrmLostReason[]; pending?: boolean; error?: string }>()
const emit = defineEmits<{ record: [call: CrmCallDraft] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const outcomeId = ref<number | undefined>()
const note = ref('')
const duration = ref<number | undefined>()
const sale = ref<CrmSaleDraft>({ package_id: null, final_price: null })
const lostReasonId = ref<number | undefined>()
const attempted = ref(false)
// True while anything is entered, so the page can guard the unsent call; it clears when the form goes away.
const dirty = defineModel<boolean>('dirty', { default: false })
const entered = computed(() => Boolean(outcomeId.value || note.value.trim() || duration.value || sale.value.package_id || sale.value.final_price !== null || lostReasonId.value))

const outcome = computed(() => props.outcomes.find(item => item.id === outcomeId.value))
const selling = computed(() => outcome.value?.effect === 'won')
const askReason = computed(() => outcome.value?.effect === 'lost' && outcome.value.lost_reason_id === null)
const locked = computed(() => !hydrated.value || props.pending)

watch(outcomeId, () => { attempted.value = false })
watch(entered, value => { dirty.value = value }, { immediate: true })
onBeforeUnmount(() => { dirty.value = false })

function submit() {
  attempted.value = true
  const chosen = outcome.value
  if (!chosen) return
  const draft: CrmCallDraft = { outcome_id: chosen.id }
  if (askReason.value) {
    if (!lostReasonId.value) return
    draft.lost_reason_id = lostReasonId.value
  }
  if (note.value.trim()) draft.note = note.value.trim()
  if (duration.value) draft.duration_minutes = duration.value
  if (selling.value) {
    if (!sale.value.package_id || sale.value.final_price === null) return
    draft.package_id = sale.value.package_id
    draft.final_price = sale.value.final_price
  }
  emit('record', draft)
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('crm.opportunities.call.title')">
    <UForm novalidate :state="{}" class="grid gap-4" data-testid="crm-call-form" @submit="submit">
      <UFormField :label="t('crm.opportunities.call.outcome')" name="call-outcome" required :error="attempted && !outcome ? t('crm.opportunities.call.outcomeRequired') : undefined">
        <USelect id="call-outcome" v-model="outcomeId" class="w-full" :items="outcomes.map(item => ({ value: item.id, label: item.name }))" :placeholder="t('crm.opportunities.call.outcomePlaceholder')" :disabled="locked" />
      </UFormField>
      <UAlert v-if="!outcomes.length" color="neutral" variant="subtle" :description="t('crm.opportunities.call.noOutcomes')" data-testid="crm-no-outcomes" />
      <CrmOpportunitySaleForm v-if="selling" v-model="sale" :packages="packages" :disabled="locked" :show-errors="attempted" />
      <template v-if="askReason">
        <UAlert color="warning" variant="subtle" :description="t('crm.opportunities.call.lostNeedsReason')" />
        <UFormField :label="t('crm.opportunities.lost.reason')" name="call-lost-reason" required :error="attempted && !lostReasonId ? t('crm.opportunities.lost.reasonRequired') : undefined">
          <USelect id="call-lost-reason" v-model="lostReasonId" class="w-full" :items="lostReasons.map(reason => ({ value: reason.id, label: reason.name }))" :placeholder="t('crm.opportunities.lost.reasonPlaceholder')" :disabled="locked" />
        </UFormField>
      </template>
      <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <UFormField :label="t('crm.opportunities.call.note')" name="call-note">
          <UTextarea id="call-note" v-model="note" class="w-full" :rows="2" :maxlength="2000" :disabled="locked" />
        </UFormField>
        <UFormField :label="t('crm.opportunities.call.duration')" name="call-duration">
          <UInputNumber id="call-duration" v-model="duration" class="w-full" :min="0" :max="1440" :disabled="locked" />
        </UFormField>
      </div>
      <UAlert v-if="error" role="alert" color="error" variant="subtle" :description="error" />
      <div class="flex justify-end">
        <UButton type="submit" :loading="pending" :disabled="locked" :label="askReason ? t('crm.opportunities.call.lostSubmit') : selling ? t('crm.opportunities.sale.submit') : t('crm.opportunities.call.submit')" data-testid="crm-call-submit" />
      </div>
    </UForm>
  </SharedRecordSection>
</template>
