<script setup lang="ts">
import type { CrmLostReason, CrmOpportunity, CrmOutcome, CrmPackage, CustomerCandidate, CustomerLink } from '@liwan/contracts'
import CrmOpportunityCallForm, { type CrmCallDraft } from '@/components/crm/opportunity/CrmOpportunityCallForm.vue'
import CustomerConflictStep from '@/components/customers/CustomerConflictStep.vue'
import { relativeTime } from '@/utils/crmOpportunity'
import { callOutcomesFor } from '@/utils/crmOrderGate'

// The agent's calls that are due now, oldest first as the server sends them: the name opens the record, the phone is a tel: link,
// and «record the result» opens the call form in the row. One form is open at a time; while it holds text no other row opens.
// `total` is how many are due, so the list can say it shows only the first few. `failure` is the text of a refusal the form could
// not settle, shown under the open row with a link to the record. `candidates` are the customers sharing the phone of a sold call
// the server stopped: the open row asks which one to link, and the answer goes back through `choose` to repeat the call.
const props = defineProps<{
  items: CrmOpportunity[]
  total: number
  viewAllTo: string
  now?: number
  loading?: boolean
  error?: unknown
  canRecord?: boolean
  outcomes?: CrmOutcome[]
  packages?: CrmPackage[]
  lostReasons?: CrmLostReason[]
  pending?: boolean
  failure?: string
  candidates?: CustomerCandidate[] | null
}>()
const emit = defineEmits<{ retry: []; record: [id: number, call: CrmCallDraft]; choose: [choice: CustomerLink]; dismiss: [] }>()
const openId = defineModel<number | null>('openId', { default: null })
const dirty = defineModel<boolean>('dirty', { default: false })
const { t, locale } = useI18n()
const hydrated = useHydrated()
const clock = computed(() => props.now ?? Date.now())
const formId = (id: number) => `crm-due-call-${id}`

function toggle(id: number) {
  openId.value = openId.value === id ? null : id
}
</script>

<template>
  <SharedRecordSection variant="list" :title="t('crm.dashboard.agent.dueTitle')" data-testid="crm-due-list">
    <SharedPageState v-if="loading || error" :loading="loading" :error="error" @retry="emit('retry')" />
    <SharedEmptyState icon="i-lucide-calendar-clock" v-else-if="!items.length" class="m-(--liwan-card-pad-dense)" :title="t('crm.dashboard.agent.dueEmpty')" />
    <ul v-else class="divide-y divide-default">
      <li v-for="item in items" :key="item.id" class="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-(--liwan-card-pad) py-3">
        <div class="min-w-0">
          <NuxtLink :to="`/crm/opportunities/${item.id}`" class="block truncate font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ item.contact_name }}</NuxtLink>
          <div class="flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
            <time v-if="item.next_call_at" class="text-warning" :datetime="item.next_call_at">{{ relativeTime(item.next_call_at, clock, locale) }}</time>
            <span v-if="item.stage" class="truncate text-muted" data-testid="crm-due-stage">{{ item.stage.name }}</span>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <UButton :href="`tel:${item.phone}`" color="neutral" variant="outline" size="sm" class="max-sm:min-h-11" icon="i-lucide-phone" :aria-label="t('crm.dashboard.agent.call', { name: item.contact_name })" data-testid="crm-due-phone"><bdi>{{ item.phone }}</bdi></UButton>
          <UButton
            v-if="canRecord"
            color="neutral"
            variant="ghost"
            size="sm"
            class="max-sm:min-h-11"
            :label="t('crm.dashboard.agent.recordResult')"
            :aria-expanded="openId === item.id"
            :aria-controls="formId(item.id)"
            :disabled="!hydrated || (dirty && openId !== item.id)"
            data-testid="crm-due-record"
            @click="toggle(item.id)"
          />
        </div>
        <div v-if="canRecord && openId === item.id" :id="formId(item.id)" class="grid basis-full gap-2">
          <CrmOpportunityCallForm v-model:dirty="dirty" :outcomes="callOutcomesFor(outcomes ?? [], item.win_by_order)" :packages="packages ?? []" :lost-reasons="lostReasons ?? []" :pending="pending" :error="failure" @record="call => emit('record', item.id, call)" @cancel="openId = null" />
          <CustomerConflictStep v-if="candidates" :candidates="candidates" :pending="pending" :description="t('customers.link.conflictDescription')" :confirm-label="t('customers.link.conflictConfirm')" @open="emit('choose', { customer_id: $event })" @create-new="emit('choose', { create_new: true })" @cancel="emit('dismiss')" />
          <NuxtLink v-if="failure" :to="`/crm/opportunities/${item.id}`" class="text-sm font-semibold text-primary hover:underline" data-testid="crm-due-open-record">{{ t('crm.dashboard.agent.openRecord') }}</NuxtLink>
        </div>
      </li>
    </ul>
    <template v-if="total > items.length" #actions>
      <NuxtLink :to="viewAllTo" class="text-sm font-semibold text-primary hover:underline">{{ t('crm.dashboard.agent.dueAll') }}</NuxtLink>
    </template>
  </SharedRecordSection>
</template>
