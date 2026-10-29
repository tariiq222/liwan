<script setup lang="ts">
import { formatDate, formatDateTime } from '@webvue/ui/app/utils/formatDate'
import { statusTag, type PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'
import CrmOpportunityCallForm, { type CrmCallDraft } from '@/components/crm/opportunity/CrmOpportunityCallForm.vue'
import CrmOpportunityCallLog from '@/components/crm/opportunity/CrmOpportunityCallLog.vue'
import CrmOpportunityLostForm from '@/components/crm/opportunity/CrmOpportunityLostForm.vue'
import CrmOpportunitySaleForm, { type CrmSaleDraft } from '@/components/crm/opportunity/CrmOpportunitySaleForm.vue'
import { useCrmLostReasonChoices, useCrmOutcomeChoices, useCrmPackageChoices, useCrmStageChoices } from '@/composables/crm/useCrmLists'
import { useCrmTerms } from '@/composables/crm/useCrmTerms'
import { useCrmCalls, useCrmOpportunity, useCrmOpportunityActions } from '@/composables/crm/useOpportunities'
import { owningListBack } from '@/utils/recordListOrigin'
import { crmErrorMessage } from '@/utils/crmErrors'
import { ApiError } from '@/composables/useApi'
import { CRM_LIST_PATH, formatPrice, isCallDue, movableStages, relativeTime } from '@/utils/crmOpportunity'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const { term } = useCrmTerms()
const toast = useToast()
const sourcePaths = useRecordListPaths([CRM_LIST_PATH])
const backTo = computed(() => router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath)

const id = computed(() => Number(route.params.id))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const canRead = computed(() => can('crm.leads.read'))
const query = useCrmOpportunity(id)
// An id that is not a record number never loads: it answers like a record that does not exist.
const loadError = computed(() => (validId.value ? query.error.value : new ApiError(404, 'not_found', t('errors.notFound'))))
const loading = computed(() => validId.value && query.isPending.value)
const calls = useCrmCalls(id)
const stages = useCrmStageChoices()
const outcomes = useCrmOutcomeChoices()
const packages = useCrmPackageChoices()
const lostReasons = useCrmLostReasonChoices()
// The reason the follow-up engine closes with is not a manual choice.
const manualLostReasons = computed(() => (lostReasons.data.value?.items ?? []).filter(reason => !reason.protected))
const actions = useCrmOpportunityActions()
const record = query.data
const now = ref(Date.now())

const pending = computed(() => record.value?.status === 'pending')
const canAssign = computed(() => can('crm.leads.assign'))
const canWork = computed(() => Boolean(record.value) && pending.value && can('crm.leads.work') && (record.value?.user?.id === me.value?.id || canAssign.value))
const canReopen = computed(() => canAssign.value && (record.value?.status === 'lost' || (pending.value && record.value?.needs_manager)))
const due = computed(() => (record.value ? isCallDue(record.value, now.value) : false))

const headerTags = computed<PageHeaderTag[]>(() => {
  if (!record.value) return []
  const tags = [statusTag({ tone: record.value.status === 'won' ? 'success' : record.value.status === 'lost' ? 'destructive' : 'info', label: t(`crm.opportunities.status.${record.value.status}`) })]
  if (record.value.needs_manager) tags.push({ label: t('crm.opportunities.tag.needsManager'), tone: 'warning' })
  else if (due.value) tags.push({ label: t('crm.opportunities.tag.due'), tone: 'warning' })
  return tags
})

type Panel = 'sale' | 'lost' | null
const panel = ref<Panel>(null)
const saleDraft = ref<CrmSaleDraft>({ package_id: null, final_price: null })
const saleAttempted = ref(false)
const callFormKey = ref(0)
// An unsent call, sale or lost reason is a draft: leaving the page asks first. Each form reports what is entered.
const callDirty = ref(false)
const lostDirty = ref(false)
const saleDirty = computed(() => panel.value === 'sale' && (Boolean(saleDraft.value.package_id) || saleDraft.value.final_price !== null))
const unsent = computed(() => callDirty.value || lostDirty.value || saleDirty.value)
// A refusal belongs to the form that sent it and shows there only; one from a page action, or whose form went away
// (a 409 refreshed the record and the form with it), shows at the top of the page.
type Origin = 'page' | 'call' | 'sale' | 'lost'
const failure = ref<{ error: unknown; origin: Origin; sale: boolean } | null>(null)
const failureText = computed(() => (failure.value ? crmErrorMessage(failure.value.error, t, { sale: failure.value.sale }) : ''))
const formShown = computed<Record<Origin, boolean>>(() => ({
  page: false,
  call: canWork.value && panel.value === null,
  sale: canWork.value && panel.value === 'sale',
  lost: canWork.value && panel.value === 'lost',
}))
const pageFailure = computed(() => Boolean(failure.value) && !formShown.value[failure.value!.origin])
const textFor = (origin: Origin) => (failure.value?.origin === origin ? failureText.value : '')
const recorded = ref('')

function resetSale() {
  saleDraft.value = { package_id: null, final_price: null }
  saleAttempted.value = false
}

function open(next: Panel) {
  panel.value = panel.value === next ? null : next
  failure.value = null
  resetSale()
}

async function run<T>(origin: Origin, work: () => Promise<T>, sale = false): Promise<T | undefined> {
  failure.value = null
  try {
    return await work()
  } catch (error) {
    failure.value = { error, origin, sale }
    return undefined
  }
}

async function recordCall(draft: CrmCallDraft) {
  recorded.value = ''
  const result = await run('call', () => actions.recordCall.mutateAsync({ id: id.value, body: draft }), draft.package_id !== undefined)
  if (!result) return
  callFormKey.value++
  const next = result.opportunity.next_call_at
  recorded.value = next
    ? t('crm.opportunities.call.nextCall', { relative: relativeTime(next, Date.now(), locale.value), absolute: formatDateTime(next) })
    : t(result.opportunity.status === 'won' ? 'crm.opportunities.sale.sold' : 'crm.opportunities.call.recorded')
  now.value = Date.now()
}

async function closeLost(lostReasonId: number) {
  const done = await run('lost', () => actions.lose.mutateAsync({ id: id.value, body: { lost_reason_id: lostReasonId } }))
  if (!done) return
  panel.value = null
  toast.add({ title: t('crm.opportunities.lost.done'), color: 'success' })
}

async function sell() {
  saleAttempted.value = true
  const { package_id, final_price } = saleDraft.value
  if (!package_id || final_price === null) return
  const done = await run('sale', () => actions.sell.mutateAsync({ id: id.value, body: { package_id, final_price } }), true)
  if (!done) return
  panel.value = null
  resetSale()
  toast.add({ title: t('crm.opportunities.sale.sold'), color: 'success' })
}

async function reopen() {
  const done = await run('page', () => actions.reopen.mutateAsync({ id: id.value, body: null }))
  if (done) resetSale()
  if (done) toast.add({ title: t('crm.opportunities.record.reopened'), color: 'success' })
}

async function changeStage(value: unknown) {
  const stageId = Number(value)
  if (!stageId || stageId === record.value?.stage?.id) return
  const done = await run('page', () => actions.patch.mutateAsync({ id: id.value, body: { stage_id: stageId } }))
  if (done) toast.add({ title: t('crm.opportunities.record.stageSaved'), color: 'success' })
}

const assignee = ref<number | null>(null)
async function assign() {
  if (!assignee.value) return
  const done = await run('page', () => actions.assign.mutateAsync({ id: id.value, body: { user_id: assignee.value! } }))
  if (!done) return
  assignee.value = null
  toast.add({ title: t('crm.opportunities.record.assigned'), color: 'success' })
}

const hydrated = useHydrated()
// Disabled until hydrated, so a first click on the server-rendered page is never lost.
const busy = computed(() => !hydrated.value || Object.values(actions).some(action => action.isPending.value))
const stageItems = computed(() => movableStages(stages.data.value?.items ?? []).map(stage => ({ value: stage.id, label: stage.name })))
</script>

<template>
  <SharedForbiddenState v-if="!canRead" />
  <SharedRecordPage v-else :title="record?.contact_name ?? ''" :tags="headerTags" :back-to="backTo" :back-label="t('crm.opportunities.record.back')" :loading="loading" :error="loadError" @retry="query.refetch()">
    <template #actions>
      <UButton v-if="canWork" color="neutral" variant="outline" icon="i-lucide-badge-check" :label="t('crm.opportunities.sale.title', { term: term('package', 'one') })" :disabled="busy" data-testid="crm-open-sale" @click="open('sale')" />
      <UButton v-if="canWork" color="neutral" variant="outline" icon="i-lucide-circle-x" :label="t('crm.opportunities.lost.action')" :disabled="busy" data-testid="crm-open-lost" @click="open('lost')" />
      <UButton v-if="canReopen" color="neutral" variant="outline" icon="i-lucide-rotate-ccw" :label="t('crm.opportunities.record.reopen')" :loading="actions.reopen.isPending.value" :disabled="busy" data-testid="crm-reopen" @click="reopen" />
    </template>
    <template v-if="record" #summary>
      <SharedRecordSection variant="tinted" :title="t('crm.opportunities.record.nextCall')">
        <p v-if="!pending" class="text-sm">{{ t(record.status === 'won' ? 'crm.opportunities.record.closedWon' : 'crm.opportunities.record.closedLost') }}</p>
        <p v-else-if="record.needs_manager" class="text-sm" data-testid="crm-manager-banner">{{ t('crm.opportunities.record.managerBanner') }}</p>
        <p v-else-if="record.next_call_at" class="text-sm" data-testid="crm-next-call">
          <time :datetime="record.next_call_at" class="font-semibold" :class="due ? 'text-warning' : 'text-highlighted'">{{ due ? t('crm.opportunities.record.nextCallDue') : relativeTime(record.next_call_at, now, locale) }}</time>
          <span class="text-muted"> · {{ formatDateTime(record.next_call_at) }}</span>
        </p>
        <p v-else class="text-sm text-muted">{{ t('crm.opportunities.record.nextCallNone') }}</p>
      </SharedRecordSection>
    </template>
    <template v-if="record">
      <SharedUnsavedChanges :dirty="unsent" guard-route-updates />
      <UAlert v-if="recorded" role="status" color="success" variant="subtle" :description="recorded" data-testid="crm-recorded" />
      <UAlert v-if="pageFailure" role="alert" color="error" variant="subtle" :description="failureText" data-testid="crm-failure" />
      <CrmOpportunityLostForm v-if="panel === 'lost' && canWork" v-model:dirty="lostDirty" :reasons="manualLostReasons" :pending="actions.lose.isPending.value" :error="textFor('lost')" @confirm="closeLost" @cancel="open('lost')" />
      <SharedRecordSection v-if="panel === 'sale' && canWork" variant="panel" :title="t('crm.opportunities.sale.title', { term: term('package', 'one') })">
        <div class="grid gap-4">
          <CrmOpportunitySaleForm v-model="saleDraft" :packages="packages.data.value?.items ?? []" :disabled="busy" :show-errors="saleAttempted" />
          <UAlert v-if="textFor('sale')" role="alert" color="error" variant="subtle" :description="textFor('sale')" />
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="outline" :label="t('app.cancel')" @click="open('sale')" />
            <UButton :loading="actions.sell.isPending.value" :disabled="busy" :label="t('crm.opportunities.sale.submit')" data-testid="crm-sale-submit" @click="sell" />
          </div>
        </div>
      </SharedRecordSection>
      <CrmOpportunityCallForm v-if="canWork && panel === null" :key="callFormKey" v-model:dirty="callDirty" :outcomes="outcomes.data.value?.items ?? []" :packages="packages.data.value?.items ?? []" :lost-reasons="manualLostReasons" :pending="actions.recordCall.isPending.value" :error="textFor('call')" @record="recordCall" />
      <CrmOpportunityCallLog :calls="calls.items.value" :total="calls.data.value?.pages.at(-1)?.total ?? 0" :has-more="!!calls.hasNextPage.value" :loading-more="calls.isFetchingNextPage.value" @more="calls.fetchNextPage()" />
    </template>
    <template v-if="record" #aside>
      <SharedPropertiesPanel :title="t('crm.opportunities.record.details')">
        <SharedPropertyRow :label="t('crm.opportunities.record.phone')"><a :href="`tel:${record.phone}`" class="hover:underline" data-testid="crm-phone"><bdi>{{ record.phone }}</bdi></a></SharedPropertyRow>
        <SharedPropertyRow :label="t('crm.opportunities.record.email')" :value="record.email" />
        <SharedPropertyRow :label="t('crm.opportunities.record.stage')">
          <USelect v-if="canWork" class="w-full" :model-value="record.stage?.id" :items="stageItems" :aria-label="t('crm.opportunities.record.stageChange')" :disabled="busy" data-testid="crm-stage-select" @update:model-value="changeStage" />
          <template v-else>{{ record.stage?.name }}</template>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('crm.opportunities.record.agent')" :value="record.user?.name ?? t('crm.opportunities.tag.pool')" />
        <SharedPropertyRow :label="t('crm.opportunities.record.source')" :value="record.source?.name" />
        <SharedPropertyRow v-if="record.package" :label="term('package', 'one')" :value="record.package.name" />
        <SharedPropertyRow v-if="record.package" :label="t('crm.opportunities.record.listPrice', { term: term('package', 'one') })" :value="formatPrice(record.list_price)" />
        <SharedPropertyRow v-if="record.package" :label="t('crm.opportunities.record.discount')" :value="`${record.discount_percent}%`" />
        <SharedPropertyRow v-if="record.package" :label="t('crm.opportunities.record.finalPrice')" :value="formatPrice(record.final_price)" />
        <SharedPropertyRow v-if="record.lost_reason" :label="t('crm.opportunities.record.lostReason')" :value="record.lost_reason.name" />
        <SharedPropertyRow :label="t('crm.opportunities.record.attempts')" :value="record.attempt_count" />
        <SharedPropertyRow v-if="record.cycle" :label="t('crm.opportunities.record.cycle')" :value="record.cycle" />
        <SharedPropertyRow v-if="record.recycle_at" :label="t('crm.opportunities.record.recycleAt')" :value="formatDate(record.recycle_at)" />
        <SharedPropertyRow :label="t('crm.opportunities.record.created')" :value="formatDate(record.created_at)" />
      </SharedPropertiesPanel>
      <SharedRecordSection v-if="canAssign && pending" variant="panel" :title="t('crm.opportunities.record.assign')">
        <div class="grid gap-3">
          <SharedPersonPicker v-model="assignee" value-key="user_id" endpoint="/api/v1/crm/agents" :aria-label="t('crm.opportunities.record.assign')" :disabled="busy" />
          <UButton :disabled="busy || !assignee" :loading="actions.assign.isPending.value" :label="t('crm.opportunities.record.assignAction')" data-testid="crm-assign" @click="assign" />
        </div>
      </SharedRecordSection>
    </template>
  </SharedRecordPage>
</template>
