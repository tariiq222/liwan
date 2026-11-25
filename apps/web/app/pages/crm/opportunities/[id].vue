<script setup lang="ts">
import type { CrmOpportunityMeetingCreate, CrmOpportunityPatch, CrmOpportunityTaskCreate, CustomFieldValues, CustomerLink } from '@liwan/contracts'
import { formatDate, formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { statusTag, type PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import CustomerConflictStep from '@/components/customers/CustomerConflictStep.vue'
import CustomerLinkBlock from '@/components/customers/CustomerLinkBlock.vue'
import CrmOpportunityCallForm, { type CrmCallDraft } from '@/components/crm/opportunity/CrmOpportunityCallForm.vue'
import CrmOpportunityCallLog from '@/components/crm/opportunity/CrmOpportunityCallLog.vue'
import CrmOpportunityContactForm from '@/components/crm/opportunity/CrmOpportunityContactForm.vue'
import CrmOpportunityConversations from '@/components/crm/opportunity/CrmOpportunityConversations.vue'
import CrmOpportunityMeetings from '@/components/crm/opportunity/CrmOpportunityMeetings.vue'
import CrmOpportunityOrders from '@/components/crm/opportunity/CrmOpportunityOrders.vue'
import CrmOpportunityLostForm from '@/components/crm/opportunity/CrmOpportunityLostForm.vue'
import CrmOpportunitySaleForm, { type CrmSaleDraft } from '@/components/crm/opportunity/CrmOpportunitySaleForm.vue'
import CrmOpportunityTasks from '@/components/crm/opportunity/CrmOpportunityTasks.vue'
import { useCustomerConflict } from '@/composables/customers/useCustomerConflict'
import { useCrmLostReasonChoices, useCrmOutcomeChoices, useCrmPackageChoices, useCrmSourceChoices, useCrmStageChoices } from '@/composables/crm/useCrmLists'
import { useOpportunityConversationAccess, useOpportunityConversations, useCreateOpportunityMeeting, useCreateOpportunityOrder, useCreateOpportunityTask, useOpportunityMeetingAccess, useOpportunityMeetings, useOpportunityOrderAccess, useOpportunityOrders, useOpportunityTaskAccess, useOpportunityTasks } from '@/composables/crm/useOpportunityBridges'
import { useCrmTerms } from '@/composables/crm/useCrmTerms'
import { useCrmCalls, useCrmOpportunity, useCrmOpportunityActions, useCrmOpportunityOpening } from '@/composables/crm/useOpportunities'
import { owningListBack } from '@/utils/recordListOrigin'
import { crmErrorMessage } from '@/utils/crmErrors'
import { callRecordedText } from '@/utils/crmCallResult'
import { callOutcomesFor, opportunityOrderGate } from '@/utils/crmOrderGate'
import { canWorkOpportunity } from '@/utils/crmBoardMove'
import { ApiError } from '@/composables/useApi'
import { CRM_LIST_PATH, formatPrice, isCallDue, manualLostReasons, movableStages, relativeTime } from '@/utils/crmOpportunity'

// Going straight from one opportunity to another (the notification bell) reuses a page component, and its open panel, drafts and
// refusals would carry over. Keying by the id remounts the page per record; a query or hash change on the same record keeps it.
definePageMeta({ key: route => `crm-opportunity-${String(route.params.id)}` })
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
const sources = useCrmSourceChoices()
const outcomes = useCrmOutcomeChoices()
const packages = useCrmPackageChoices()
const lostReasons = useCrmLostReasonChoices()
// The reason the follow-up engine closes with is not a manual choice.
const choosableLostReasons = computed(() => manualLostReasons(lostReasons.data.value?.items ?? []))
const callOutcomes = computed(() => callOutcomesFor(outcomes.data.value?.items ?? [], winByOrder.value))
const actions = useCrmOpportunityActions()
const record = query.data
const now = ref(Date.now())
// The view log is the explicit POST this page sends once the record loads, never the GET above: a prefetch or
// a link preview reads the record but records no opening, and a read that failed records nothing either.
const hydrated = useHydrated()
useCrmOpportunityOpening(id, hydrated, computed(() => query.isSuccess.value))

const pending = computed(() => record.value?.status === 'pending')
// With Sales in the plan an order wins the opportunity, so the package form (and the sold outcome of a call) steps aside.
const gate = computed(() => (record.value ? opportunityOrderGate(record.value, orderAccess.write.value) : null))
const winByOrder = computed(() => gate.value?.winByOrder === true)
const canAssign = computed(() => can('crm.leads.assign'))
const canWork = computed(() => canWorkOpportunity(record.value, { work: can('crm.leads.work'), assign: canAssign.value, userId: me.value?.id }))
const canReopen = computed(() => canAssign.value && (record.value?.status === 'lost' || (pending.value && record.value?.needs_manager)))
const due = computed(() => (record.value ? isCallDue(record.value, now.value) : false))

const headerTags = computed<PageHeaderTag[]>(() => {
  if (!record.value) return []
  const tags = [statusTag({ tone: record.value.status === 'won' ? 'success' : record.value.status === 'lost' ? 'destructive' : 'info', label: t(`crm.opportunities.status.${record.value.status}`) })]
  if (record.value.needs_manager) tags.push({ label: t('crm.opportunities.tag.needsManager'), tone: 'warning' })
  else if (due.value) tags.push({ label: t('crm.opportunities.tag.due'), tone: 'warning' })
  return tags
})

type Panel = 'sale' | 'lost' | 'contact' | null
const panel = ref<Panel>(null)
const saleDraft = ref<CrmSaleDraft>({ package_id: null, final_price: null })
const saleAttempted = ref(false)
const callFormKey = ref(0)
// An unsent call, sale, lost reason or probability is a draft: leaving the page asks first. Each form reports what is entered.
const probability = ref<number>(0)
watch(() => record.value?.probability, value => { probability.value = value ?? 0 }, { immediate: true })
const probabilityDirty = computed(() => Boolean(record.value) && probability.value !== record.value?.probability)
// The company's custom fields: the rows report which values changed, and one save sends just those.
const customChanged = ref<CustomFieldValues>({})
const customDirty = ref(false)
const customErrors = ref<Record<string, string>>({})
const callDirty = ref(false)
const contactDirty = ref(false)
const lostDirty = ref(false)
const saleDirty = computed(() => panel.value === 'sale' && (Boolean(saleDraft.value.package_id) || saleDraft.value.final_price !== null))
const unsent = computed(() => callDirty.value || lostDirty.value || saleDirty.value || probabilityDirty.value || customDirty.value || contactDirty.value)
// A refusal belongs to the form that sent it and shows there only; one from a page action, or whose form went away
// (a 409 refreshed the record and the form with it), shows at the top of the page.
type Origin = 'page' | 'call' | 'sale' | 'lost' | 'contact' | 'link'
const failure = ref<{ error: unknown; origin: Origin; sale: boolean } | null>(null)
const failureText = computed(() => (failure.value ? crmErrorMessage(failure.value.error, t, { sale: failure.value.sale }) : ''))
const formShown = computed<Record<Origin, boolean>>(() => ({
  page: false,
  call: canWork.value && panel.value === null,
  sale: canWork.value && panel.value === 'sale',
  lost: canWork.value && panel.value === 'lost',
  contact: canWork.value && panel.value === 'contact',
  link: Boolean(record.value),
}))
const pageFailure = computed(() => Boolean(failure.value) && !formShown.value[failure.value!.origin])
const textFor = (origin: Origin) => (failure.value?.origin === origin ? failureText.value : '')
// The contact editor reads the structured error itself, to place duplicate-phone and invalid-email on their field.
const errorFor = (origin: Origin) => (failure.value?.origin === origin ? failure.value.error : undefined)
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

// Customers sharing the record's phone stop a link, a win or a sold call at the same step: the user picks one of them or
// asks for a new customer, and the attempt that stopped is repeated with that answer. Nothing is linked before then.
const conflict = useCustomerConflict()
const conflictOrigin = ref<Origin | null>(null)

// `done` holds the steps that follow a success: they run after the first attempt and after the one a conflict answer repeats.
function run<T>(origin: Origin, work: (choice: CustomerLink) => Promise<T>, done: (result: T) => void, sale = false, choice: CustomerLink = {}): Promise<T | undefined> {
  failure.value = null
  conflictOrigin.value = origin
  return conflict.attempt(work, { choice, done, failed: error => { failure.value = { error, origin, sale } } })
}

async function recordCall(draft: CrmCallDraft) {
  recorded.value = ''
  await run('call', choice => actions.recordCall.mutateAsync({ id: id.value, body: { ...draft, ...choice } }), (result) => {
    callFormKey.value++
    recorded.value = callRecordedText(result.opportunity, t, locale.value)
    now.value = Date.now()
  }, draft.package_id !== undefined)
}

async function closeLost(lostReasonId: number) {
  await run('lost', () => actions.lose.mutateAsync({ id: id.value, body: { lost_reason_id: lostReasonId } }), () => {
    panel.value = null
    toast.add({ title: t('crm.opportunities.lost.done'), color: 'success' })
  })
}

async function sell() {
  saleAttempted.value = true
  const { package_id, final_price } = saleDraft.value
  if (!package_id || final_price === null) return
  await run('sale', choice => actions.sell.mutateAsync({ id: id.value, body: { package_id, final_price, ...choice } }), () => {
    panel.value = null
    resetSale()
    toast.add({ title: t('crm.opportunities.sale.sold'), color: 'success' })
  }, true)
}

const linkOpen = computed(() => conflict.candidates.value && conflictOrigin.value === 'link' ? conflict.candidates.value : null)
const stepOpen = computed(() => conflict.candidates.value && conflictOrigin.value !== 'link' ? conflict.candidates.value : null)
async function linkCustomer(choice: CustomerLink) {
  await run('link', next => actions.linkCustomer.mutateAsync({ id: id.value, body: next }), () => {
    toast.add({ title: t('crm.opportunities.customer.linked'), color: 'success' })
  }, false, choice)
}
// An answer to a stopped link repeats that link; a first request starts one.
const onCustomerLink = (choice: CustomerLink) => (linkOpen.value ? conflict.choose(choice) : linkCustomer(choice))

// The other applications' sections: shown only while the tenant has the application and the user holds both
// applications' capabilities. A refusal (403) from the section's own read hides it and leaves the page working.
const taskAccess = useOpportunityTaskAccess()
const meetingAccess = useOpportunityMeetingAccess()
const orderAccess = useOpportunityOrderAccess()
const refused = (error: unknown) => (error as { status?: number } | null)?.status === 403
const taskList = useOpportunityTasks(id, taskAccess.read)
const meetingList = useOpportunityMeetings(id, meetingAccess.read)
const orderList = useOpportunityOrders(id, orderAccess.read)
const conversationAccess = useOpportunityConversationAccess()
const conversationList = useOpportunityConversations(id, conversationAccess)
const showConversations = computed(() => conversationAccess.value && !refused(conversationList.error.value))
const showTasks = computed(() => taskAccess.read.value && !refused(taskList.error.value))
const showOrders = computed(() => orderAccess.read.value && !refused(orderList.error.value))
const showMeetings = computed(() => meetingAccess.read.value && !refused(meetingList.error.value))
// The server writes through the record's own write check: its agent or an assigner.
const ownsRecord = computed(() => Boolean(record.value) && (record.value?.user?.id === me.value?.id || canAssign.value))
const createTask = useCreateOpportunityTask(id)
const createMeeting = useCreateOpportunityMeeting(id)
const tasksPanel = ref<InstanceType<typeof CrmOpportunityTasks>>()
const meetingsPanel = ref<InstanceType<typeof CrmOpportunityMeetings>>()
const createOrder = useCreateOpportunityOrder(id)
// A closed or archived opportunity takes no quotation, and a quotation takes the opportunity's customer.
const orderBlocked = computed(() => gate.value?.blocked ?? null)
const taskError = ref('')
const meetingError = ref('')
const orderError = ref('')

async function addTask(body: CrmOpportunityTaskCreate) {
  taskError.value = ''
  try {
    await createTask.mutateAsync(body)
    tasksPanel.value?.reset()
    toast.add({ title: t('crm.opportunities.tasks.added'), color: 'success' })
  } catch (error) {
    taskError.value = crmErrorMessage(error, t)
  }
}

async function addOrder() {
  orderError.value = ''
  try {
    const created = await createOrder.mutateAsync()
    toast.add({ title: t('crm.opportunities.orders.added'), color: 'success' })
    // The quotation's page goes back to this opportunity (the opportunity is a registered record source of the Sales page).
    await navigateTo({ path: `/sales/${created.id}`, query: { returnTo: route.path } })
  } catch (error) {
    orderError.value = crmErrorMessage(error, t)
  }
}

async function addMeeting(body: CrmOpportunityMeetingCreate) {
  meetingError.value = ''
  try {
    await createMeeting.mutateAsync(body)
    meetingsPanel.value?.reset()
    toast.add({ title: t('crm.opportunities.meetings.added'), color: 'success' })
  } catch (error) {
    meetingError.value = crmErrorMessage(error, t)
  }
}

async function reopen() {
  await run('page', () => actions.reopen.mutateAsync({ id: id.value, body: null }), () => {
    resetSale()
    toast.add({ title: t('crm.opportunities.record.reopened'), color: 'success' })
  })
}

async function changeStage(value: unknown) {
  const stageId = Number(value)
  if (!stageId || stageId === record.value?.stage?.id) return
  await run('page', () => actions.patch.mutateAsync({ id: id.value, body: { stage_id: stageId } }), () => {
    toast.add({ title: t('crm.opportunities.record.stageSaved'), color: 'success' })
  })
}

// Only the fields the user changed travel, and the server's answer is the record's new state.
async function saveContact(patch: CrmOpportunityPatch) {
  if (!Object.keys(patch).length) return
  await run('contact', () => actions.patch.mutateAsync({ id: id.value, body: patch }), () => {
    panel.value = null
    toast.add({ title: t('crm.opportunities.contact.saved'), color: 'success' })
  })
}

async function saveProbability() {
  if (probability.value === record.value?.probability) return
  await run('page', () => actions.patch.mutateAsync({ id: id.value, body: { probability: probability.value } }), () => {
    toast.add({ title: t('crm.opportunities.record.probabilitySaved'), color: 'success' })
  })
}

const PROPERTY_FIELD_PREFIX = 'properties.'

function changeCustomFields(values: CustomFieldValues) {
  customChanged.value = values
  customErrors.value = {}
}

// A refusal of one custom field's value shows under that field; any other refusal stays at the top of the page.
async function saveCustomFields() {
  customErrors.value = {}
  const done = await run('page', () => actions.patch.mutateAsync({ id: id.value, body: { properties: customChanged.value } }), () => {
    toast.add({ title: t('crm.opportunities.record.customFieldsSaved'), color: 'success' })
  })
  if (done) return
  const field = (failure.value?.error as { status?: number; field?: string } | undefined)?.field
  if (!field?.startsWith(PROPERTY_FIELD_PREFIX)) return
  customErrors.value = { [field.slice(PROPERTY_FIELD_PREFIX.length)]: failureText.value }
  failure.value = null
}

const assignee = ref<number | null>(null)
async function assign() {
  if (!assignee.value) return
  await run('page', () => actions.assign.mutateAsync({ id: id.value, body: { user_id: assignee.value! } }), () => {
    assignee.value = null
    toast.add({ title: t('crm.opportunities.record.assigned'), color: 'success' })
  })
}

// Disabled until hydrated, so a first click on the server-rendered page is never lost.
const busy = computed(() => !hydrated.value || Object.values(actions).some(action => action.isPending.value))
const stageItems = computed(() => movableStages(stages.data.value?.items ?? []).map(stage => ({ value: stage.id, label: stage.name })))
const heroTone = computed<'info' | 'success' | 'warning' | 'danger' | 'neutral'>(() => {
  if (!record.value) return 'neutral'
  if (record.value.status === 'won') return 'success'
  if (record.value.status === 'lost') return 'danger'
  if (record.value.needs_manager || due.value) return 'warning'
  return 'info'
})
const heroAmount = computed(() => {
  const item = record.value
  if (!item) return 0
  return (item.final_price ?? 0) > 0 ? item.final_price : (item.expected_revenue ?? 0)
})
</script>

<template>
  <SharedForbiddenState v-if="!canRead" />
  <SharedRecordPage v-else aside-first :title="record?.contact_name ?? ''" :tags="headerTags" :back-to="backTo" :back-label="t('crm.opportunities.record.back')" :loading="loading" :error="loadError" @retry="query.refetch()">
    <template #actions>
      <UButton v-if="canWork && !winByOrder" color="neutral" variant="outline" icon="i-lucide-badge-check" :label="t('crm.opportunities.sale.title', { term: term('package', 'one') })" :disabled="busy" data-testid="crm-open-sale" @click="open('sale')" />
      <UButton v-if="gate?.winAction" color="neutral" variant="outline" icon="i-lucide-receipt-text" :label="t('crm.opportunities.orders.winAction')" :loading="createOrder.isPending.value" :disabled="busy" data-testid="crm-open-quotation" @click="addOrder" />
      <UButton v-if="canWork" color="neutral" variant="outline" icon="i-lucide-circle-x" :label="t('crm.opportunities.lost.action')" :disabled="busy" data-testid="crm-open-lost" @click="open('lost')" />
      <UButton v-if="canReopen" color="neutral" variant="outline" icon="i-lucide-rotate-ccw" :label="t('crm.opportunities.record.reopen')" :loading="actions.reopen.isPending.value" :disabled="busy" data-testid="crm-reopen" @click="reopen" />
    </template>
    <template v-if="record" #summary>
      <SharedRecordHero :tone="heroTone" icon="i-lucide-handshake" data-testid="crm-summary">
        <!-- The identity line is the follow-up the opportunity is waiting on; the heading already carries the contact's name. -->
        <template #title>
          <span v-if="!pending" class="min-w-0 truncate">{{ t(record.status === 'won' ? 'crm.opportunities.record.closedWon' : 'crm.opportunities.record.closedLost') }}</span>
          <span v-else-if="record.needs_manager" class="min-w-0 truncate text-warning" data-testid="crm-manager-banner">{{ t('crm.opportunities.record.managerBanner') }}</span>
          <template v-else-if="record.next_call_at">
            <span class="text-muted">{{ t('crm.opportunities.record.nextCall') }}</span>
            <time :datetime="record.next_call_at" :title="formatDateTime(record.next_call_at)" class="whitespace-nowrap" :class="due ? 'text-warning' : undefined" data-testid="crm-next-call">{{ due ? t('crm.opportunities.record.nextCallDue') : relativeTime(record.next_call_at, now, locale) }}</time>
          </template>
          <span v-else class="min-w-0 truncate text-muted">{{ t('crm.opportunities.record.nextCallNone') }}</span>
        </template>
        <template v-if="canWork || (canAssign && pending)" #actions>
          <USelect v-if="canWork" class="w-40" size="sm" :model-value="record.stage?.id" :items="stageItems" :aria-label="t('crm.opportunities.record.stageChange')" :disabled="busy" data-testid="crm-stage-select" @update:model-value="changeStage" />
          <div v-if="canWork" class="flex items-center gap-1.5">
            <UInputNumber class="w-24" size="sm" :model-value="probability" :min="0" :max="100" :step="5" :disabled="busy" :aria-label="t('crm.opportunities.record.probability')" data-testid="crm-probability-input" @update:model-value="value => (probability = value ?? 0)" />
            <UButton size="xs" variant="outline" :label="t('crm.opportunities.record.probabilitySave')" :disabled="busy || probability === record.probability" :loading="actions.patch.isPending.value" data-testid="crm-probability-save" @click="saveProbability" />
          </div>
          <UPopover v-if="canAssign && pending">
            <UButton size="xs" variant="outline" :label="t('crm.opportunities.record.assignAction')" :disabled="busy" data-testid="crm-assign-open" />
            <template #content>
              <div class="grid w-64 gap-3 p-3">
                <SharedPersonPicker v-model="assignee" value-key="user_id" endpoint="/api/v1/crm/agents" :aria-label="t('crm.opportunities.record.assign')" :disabled="busy" />
                <UButton :disabled="busy || !assignee" :loading="actions.assign.isPending.value" :label="t('crm.opportunities.record.assignAction')" data-testid="crm-assign" @click="assign" />
              </div>
            </template>
          </UPopover>
        </template>
        <template #meta>
          <span v-if="record.stage && !canWork" class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-columns-3" class="size-4 shrink-0" aria-hidden="true" /><span><span class="sr-only">{{ t('crm.opportunities.record.stage') }}: </span>{{ record.stage.name }}</span></span>
          <span class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-user" class="size-4 shrink-0" aria-hidden="true" /><span><span class="sr-only">{{ t('crm.opportunities.record.agent') }}: </span>{{ record.user?.name ?? t('crm.opportunities.tag.pool') }}</span></span>
          <span v-if="!canWork" class="inline-flex items-center gap-1.5" data-testid="crm-probability"><UIcon name="i-lucide-percent" class="size-4 shrink-0" aria-hidden="true" /><span>{{ t('crm.opportunities.record.probability') }}: {{ record.probability }}%</span></span>
          <a :href="`tel:${record.phone}`" class="inline-flex items-center gap-1.5 font-medium text-primary hover:underline" data-testid="crm-phone"><UIcon name="i-lucide-phone" class="size-4 shrink-0" aria-hidden="true" /><span><span class="sr-only">{{ t('crm.opportunities.record.phone') }}: </span><bdi dir="ltr">{{ record.phone }}</bdi></span></a>
        </template>
        <SharedMetricTile
          v-if="pending"
          density="compact"
          icon="i-lucide-banknote"
          :label="t('crm.opportunities.record.expectedAmount')"
          :value="heroAmount > 0 ? formatPrice(heroAmount) : null"
          value-dir="ltr"
        />
        <SharedMetricTile
          density="compact"
          icon="i-lucide-phone-call"
          :tone="due || record.needs_manager ? 'warning' : 'neutral'"
          :label="t('crm.opportunities.record.attempts')"
          :value="record.attempt_count"
          value-dir="ltr"
        />
      </SharedRecordHero>
    </template>
    <template v-if="record">
      <SharedUnsavedChanges :dirty="unsent" guard-route-updates />
      <UAlert v-if="recorded" role="status" color="success" variant="subtle" :description="recorded" data-testid="crm-recorded" />
      <SharedRecordSection v-if="record.notes" variant="panel" :title="t('crm.opportunities.record.notes')">
        <p class="whitespace-pre-line text-sm" data-testid="crm-notes">{{ record.notes }}</p>
      </SharedRecordSection>
      <UAlert v-if="gate?.cannotQuote" role="status" color="warning" variant="subtle" :description="t('crm.opportunities.orders.cannotQuote')" data-testid="crm-quote-forbidden" />
      <UAlert v-if="pageFailure" role="alert" color="error" variant="subtle" :description="failureText" data-testid="crm-failure" />
      <CustomerConflictStep v-if="stepOpen" :candidates="stepOpen" :pending="busy" :description="t('customers.link.conflictDescription')" :confirm-label="t('customers.link.conflictConfirm')" @open="conflict.choose({ customer_id: $event })" @create-new="conflict.choose({ create_new: true })" @cancel="conflict.clear()" />
      <CrmOpportunityLostForm v-if="panel === 'lost' && canWork" v-model:dirty="lostDirty" :reasons="choosableLostReasons" :pending="actions.lose.isPending.value" :error="textFor('lost')" @confirm="closeLost" @cancel="open('lost')" />
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
      <CrmOpportunityCallForm v-if="canWork && panel === null" :key="callFormKey" v-model:dirty="callDirty" :outcomes="callOutcomes" :packages="packages.data.value?.items ?? []" :lost-reasons="choosableLostReasons" :pending="actions.recordCall.isPending.value" :error="textFor('call')" @record="recordCall" @cancel="panel = null" />
      <CrmOpportunityCallLog :calls="calls.items.value" :total="calls.data.value?.pages.at(-1)?.total ?? 0" :has-more="!!calls.hasNextPage.value" :loading-more="calls.isFetchingNextPage.value" @more="calls.fetchNextPage()" />
      <CrmOpportunityConversations v-if="showConversations" :conversations="conversationList.data.value?.items ?? []" :total="conversationList.data.value?.total ?? 0" :loading="conversationList.isPending.value && conversationList.isFetching.value" :error="conversationList.error.value" @retry="conversationList.refetch()" />
      <CrmOpportunityOrders v-if="showOrders" :orders="orderList.data.value?.items ?? []" :total="orderList.data.value?.total ?? 0" :loading="orderList.isPending.value && orderList.isFetching.value" :error="orderList.error.value" :can-write="orderAccess.write.value" :blocked="orderBlocked" :win-by-order="winByOrder && pending" :pending="createOrder.isPending.value" :form-error="orderError" @create="addOrder" @retry="orderList.refetch()" />
      <CrmOpportunityTasks v-if="showTasks" ref="tasksPanel" :tasks="taskList.data.value?.items ?? []" :total="taskList.data.value?.total ?? 0" :loading="taskList.isPending.value && taskList.isFetching.value" :error="taskList.error.value" :can-write="taskAccess.write.value && ownsRecord" :pending="createTask.isPending.value" :form-error="taskError" @create="addTask" @retry="taskList.refetch()" />
      <CrmOpportunityMeetings v-if="showMeetings" ref="meetingsPanel" :meetings="meetingList.data.value?.items ?? []" :total="meetingList.data.value?.total ?? 0" :loading="meetingList.isPending.value && meetingList.isFetching.value" :error="meetingList.error.value" :can-write="meetingAccess.write.value && ownsRecord" :pending="createMeeting.isPending.value" :form-error="meetingError" @create="addMeeting" @retry="meetingList.refetch()" />
    </template>
    <template v-if="record" #aside>
      <CrmOpportunityContactForm v-if="canWork && panel === 'contact'" v-model:dirty="contactDirty" :record="record" :sources="sources.data.value?.items ?? []" :pending="actions.patch.isPending.value" :disabled="busy" :error="errorFor('contact')" @save="saveContact" @cancel="open('contact')" />
      <div v-else-if="canWork" class="flex justify-end">
        <UButton size="xs" variant="outline" icon="i-lucide-pencil" :label="t('crm.opportunities.contact.edit')" :disabled="busy" data-testid="crm-contact-edit" @click="open('contact')" />
      </div>
      <SharedRecordSection v-if="record.customer || canWork" variant="panel" :title="t('customers.link.title')" data-testid="crm-customer">
        <CustomerLinkBlock :customer="record.customer" :can-link="canWork" :can-open="can('customers.read')" :candidates="linkOpen" :pending="actions.linkCustomer.isPending.value" :error="textFor('link')" @link="onCustomerLink" @dismiss="conflict.clear()" />
      </SharedRecordSection>
      <SharedPropertiesPanel :title="t('crm.opportunities.record.details')">
        <SharedPropertyRow :label="t('crm.opportunities.record.email')" :value="record.email" />
        <SharedPropertyRow :label="t('crm.opportunities.record.source')" :value="record.source?.name" />
        <SharedPropertyRow v-if="record.package" :label="term('package', 'one')" :value="record.package.name" />
        <SharedPropertyRow v-if="record.package" :label="t('crm.opportunities.record.listPrice', { term: term('package', 'one') })" :value="formatPrice(record.list_price)" />
        <SharedPropertyRow v-if="record.package" :label="t('crm.opportunities.record.discount')" :value="`${record.discount_percent}%`" />
        <!-- The summary carries the money while the opportunity is open; the properties keep it once it closes. -->
        <SharedPropertyRow v-if="record.package && !pending" :label="t('crm.opportunities.record.finalPrice')" :value="formatPrice(record.final_price)" />
        <SharedPropertyRow v-else-if="!record.package && record.status === 'won'" :label="t('crm.opportunities.record.wonAmount')" :value="formatPrice(record.final_price)" data-testid="crm-won-amount" />
        <SharedPropertyRow v-if="record.lost_reason" :label="t('crm.opportunities.record.lostReason')" :value="record.lost_reason.name" />
        <SharedPropertyRow v-if="record.cycle" :label="t('crm.opportunities.record.cycle')" :value="record.cycle" />
        <SharedPropertyRow v-if="record.recycle_at" :label="t('crm.opportunities.record.recycleAt')" :value="formatDate(record.recycle_at)" />
        <SharedPropertyRow :label="t('crm.opportunities.record.created')" :value="formatDate(record.created_at)" />
        <template v-if="record.properties.length">
          <SharedCustomFieldRows v-model:dirty="customDirty" :fields="record.properties" :editable="canWork" :disabled="busy" :errors="customErrors" @change="changeCustomFields" />
          <div v-if="canWork" class="flex justify-end pt-2">
            <UButton size="xs" variant="outline" :label="t('crm.opportunities.record.customFieldsSave')" :disabled="busy || !customDirty" :loading="actions.patch.isPending.value" data-testid="crm-custom-fields-save" @click="saveCustomFields" />
          </div>
        </template>
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
