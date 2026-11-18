<script setup lang="ts">
import type { CrmLostReason, CrmPackage, CrmStage } from '@liwan/contracts'
import CrmOpportunitySaleForm, { type CrmSaleDraft } from './CrmOpportunitySaleForm.vue'
import { moveChoices, type BoardMove, type MovePayload } from '@/utils/crmBoardMove'
import { manualLostReasons } from '@/utils/crmOpportunity'

// The one overlay of a board move that needs input: a bottom sheet that asks only the required fields (a stage when the
// «move» action opened it, the package and final price of a sale, the loss reason) and then confirms. Cancel, Escape and the
// backdrop all cancel; the refusal of the write shows inside.
const props = defineProps<{ move: BoardMove | null; stages: CrmStage[]; packages: CrmPackage[]; lostReasons: CrmLostReason[]; pending?: boolean; error?: string; conflict?: boolean }>()
const emit = defineEmits<{ confirm: [payload: MovePayload]; cancel: [] }>()
const { t } = useI18n()
const formId = useId()

const LOST = 'lost'
const choice = ref<string | undefined>()
const sale = ref<CrmSaleDraft>({ package_id: null, final_price: null })
const reasonId = ref<number | undefined>()
const attempted = ref(false)

watch(() => props.move, move => {
  choice.value = !move || move.to === 'pick' ? undefined : move.to === LOST ? LOST : String(move.to.id)
  sale.value = { package_id: null, final_price: null }
  reasonId.value = undefined
  attempted.value = false
}, { immediate: true })

const picker = computed(() => props.move?.to === 'pick')
const stage = computed(() => (choice.value && choice.value !== LOST ? props.stages.find(item => String(item.id) === choice.value) ?? null : null))
const mode = computed<'stage' | 'sale' | 'lost' | null>(() => (choice.value === LOST ? 'lost' : stage.value ? (stage.value.is_won ? 'sale' : 'stage') : null))
const name = computed(() => props.move?.item.contact_name ?? '')
const title = computed(() => (mode.value === 'lost' ? t('crm.opportunities.move.titleLost', { name: name.value }) : stage.value ? t('crm.opportunities.move.title', { name: name.value, stage: stage.value.name }) : t('crm.opportunities.move.titlePick', { name: name.value })))
const confirmLabel = computed(() => t(mode.value === 'lost' ? 'crm.opportunities.lost.confirm' : mode.value === 'sale' ? 'crm.opportunities.sale.submit' : 'crm.opportunities.move.confirm'))
const choiceItems = computed(() => (props.move ? [...moveChoices(props.stages, props.move.item).map(item => ({ value: String(item.id), label: item.name })), { value: LOST, label: t('crm.opportunities.lost.action') }] : []))
const reasonItems = computed(() => manualLostReasons(props.lostReasons).map(reason => ({ value: reason.id, label: reason.name })))

function submit() {
  attempted.value = true
  if (mode.value === 'lost' && reasonId.value) emit('confirm', { kind: 'lost', lostReasonId: reasonId.value })
  else if (mode.value === 'sale' && sale.value.package_id && sale.value.final_price !== null) emit('confirm', { kind: 'sale', packageId: sale.value.package_id, finalPrice: sale.value.final_price })
  else if (mode.value === 'stage' && stage.value) emit('confirm', { kind: 'stage', stageId: stage.value.id })
}
</script>

<template>
  <USlideover
    :open="Boolean(move)"
    side="bottom"
    :title="title"
    :description="t('crm.opportunities.move.description')"
    :ui="{ content: 'mx-auto w-full max-w-lg rounded-t-card', body: 'p-4 sm:p-6', footer: 'justify-end gap-2' }"
    @update:open="open => { if (!open) emit('cancel') }"
  >
    <template #body>
      <form :id="formId" class="grid gap-4" data-testid="crm-move-sheet" @submit.prevent="submit">
        <UFormField v-if="picker" :label="t('crm.opportunities.move.stage')" name="move-stage" required :error="attempted && !mode ? t('crm.opportunities.move.stageRequired') : undefined">
          <USelect id="move-stage" v-model="choice" class="w-full" :items="choiceItems" :placeholder="t('crm.opportunities.move.stagePlaceholder')" :disabled="pending" data-testid="crm-move-stage" />
        </UFormField>
        <CrmOpportunitySaleForm v-if="mode === 'sale'" v-model="sale" compact :packages="packages" :disabled="pending" :show-errors="attempted" />
        <UFormField v-else-if="mode === 'lost'" :label="t('crm.opportunities.lost.reason')" name="move-lost-reason" required :error="attempted && !reasonId ? t('crm.opportunities.lost.reasonRequired') : undefined">
          <USelect id="move-lost-reason" v-model="reasonId" class="w-full" :items="reasonItems" :placeholder="t('crm.opportunities.lost.reasonPlaceholder')" :disabled="pending" />
        </UFormField>
        <p v-if="error" role="alert" class="text-sm text-error" data-testid="crm-move-error">{{ error }}</p>
        <NuxtLink v-if="conflict && move" :to="`/crm/opportunities/${move.item.id}`" class="text-sm font-semibold text-primary hover:underline max-sm:flex max-sm:min-h-11 max-sm:items-center" data-testid="crm-move-open-record">{{ t('crm.dashboard.agent.openRecord') }}</NuxtLink>
      </form>
    </template>
    <template #footer>
      <UButton type="button" color="neutral" variant="outline" class="max-sm:min-h-11" :label="t('app.cancel')" :disabled="pending" data-testid="crm-move-cancel" @click="emit('cancel')" />
      <UButton type="submit" :form="formId" class="max-sm:min-h-11" :label="confirmLabel" :loading="pending" :disabled="!mode" data-testid="crm-move-confirm" />
    </template>
  </USlideover>
</template>
