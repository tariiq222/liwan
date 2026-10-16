<script setup lang="ts">
import type { Invoice, SubscriptionView } from '@nasq/commercial-contracts'
import { cadenceLabel, formatCommercialMoney } from '@nasq/commercial-ui/app/utils/commercial'
import { invoiceStatusBadge } from '@nasq/commercial-ui/app/utils/commercialBadges'
import { formatNasqDate } from '@nasq/ui/app/composables/calendarDate'
import type { RouteLocationRaw } from 'vue-router'
import type { ClientTab } from '@/utils/vendorClients'
import type { StatusBadgeEntry } from '@nasq/ui/app/utils/statusBadge'
import { customerDisplayBadge } from '@/utils/vendorBadges'
import { daysUntilDate, isStalled, subscriptionDisplayState } from '@/utils/vendorSubscriptions'

// The customer at a glance: plan, renewal, last invoice, workspace, and what needs attention, each linking to its tab.
const props = defineProps<{
  setupRequired: boolean
  subscription: SubscriptionView | null
  planName?: string
  /** The plan is only the target of an order that is not applied yet. */
  planPending?: boolean
  /** `undefined`: the invoices are not offered or still unknown; an empty list: none yet. */
  invoices?: Invoice[]
  hasWorkspace: boolean
  /** The status badge of the workspace (null without one), its provisioning failure and the link that opens it. */
  workspaceBadge: StatusBadgeEntry | null
  provisioningFailed: boolean
  operationFailed: boolean
  /** The workspace, its provisioning or its recent operations could not be read: nothing is claimed about open issues. */
  workspaceUnreadable: boolean
  /** The invoices tab is offered (billing grant): the past-due issue links there only then. */
  invoicesOffered: boolean
  loginUrl: string | null
  tabTo: (tab: ClientTab) => RouteLocationRaw
}>()
const emit = defineEmits<{ retry: [] }>()
const { t, locale } = useI18n()

const sub = computed(() => props.subscription)
const display = computed(() => (sub.value ? subscriptionDisplayState(sub.value) : null))
const renewal = computed(() => {
  const at = sub.value?.renewal_at
  if (!at || ['cancelled', 'suspended'].includes(sub.value?.state ?? '')) return null
  const days = daysUntilDate(at, new Date())
  const hint = days > 0 ? t('vendor.customers.glance.renewalIn', { days }) : days === 0 ? t('vendor.customers.glance.renewalToday') : t('vendor.customers.glance.renewalLate', { days: -days })
  return { date: formatNasqDate(at, locale.value), hint: `${hint} · ${t(sub.value?.auto_renew.enabled ? 'vendor.customers.glance.autoRenewOn' : 'vendor.customers.glance.autoRenewOff')}` }
})
const lastInvoice = computed(() => props.invoices?.[0] ?? null)

// Open issues, most urgent first; each one points to the tab where it is handled (when that tab is offered).
const issues = computed(() => {
  const list: { key: string; text: string; tab?: ClientTab }[] = []
  const view = sub.value
  if (props.setupRequired) list.push({ key: 'setup', text: t('vendor.customers.glance.issues.setup'), tab: 'subscription' })
  if (view?.pending_order && ['failed', 'needs_intervention'].includes(view.pending_order.fulfillment_state)) list.push({ key: 'orderFailed', text: t('vendor.customers.glance.issues.orderFailed'), tab: 'subscription' })
  else if (view && isStalled(view.pending_order, new Date())) list.push({ key: 'stalled', text: t('vendor.customers.glance.issues.stalled'), tab: 'subscription' })
  if (view?.state === 'past_due') list.push({ key: 'pastDue', text: t('vendor.customers.glance.issues.pastDue'), tab: props.invoicesOffered ? 'invoices' : undefined })
  if (props.hasWorkspace && props.provisioningFailed) list.push({ key: 'provisioning', text: t('vendor.customers.glance.issues.provisioning'), tab: 'workspace' })
  if (props.operationFailed) list.push({ key: 'operation', text: t('vendor.customers.glance.issues.operation'), tab: 'operations' })
  return list
})
</script>

<template>
  <div class="space-y-6" data-slot="customer-glance">
    <section class="rounded-lg p-4 ring" :class="issues.length || workspaceUnreadable ? 'bg-warning/5 ring-warning/40' : 'bg-default ring-default'" aria-labelledby="glance-issues-title" data-testid="glance-issues">
      <h2 id="glance-issues-title" class="flex items-center gap-2 text-sm font-semibold text-highlighted">
        <UIcon :name="issues.length || workspaceUnreadable ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'" class="size-4" :class="issues.length || workspaceUnreadable ? 'text-warning' : 'text-success'" aria-hidden="true" />
        {{ issues.length ? t('vendor.customers.glance.issuesTitle', { count: issues.length }) : workspaceUnreadable ? t('vendor.customers.glance.unreadable') : t('vendor.customers.glance.noIssues') }}
      </h2>
      <ul v-if="issues.length" class="mt-3 divide-y divide-default">
        <li v-for="issue in issues" :key="issue.key" class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm" :data-issue="issue.key">
          <span>{{ issue.text }}</span>
          <UButton v-if="issue.tab" :to="tabTo(issue.tab)" color="neutral" variant="link" size="sm" trailing-icon="i-lucide-arrow-left">{{ t(`vendor.clientTabs.${issue.tab}`) }}</UButton>
        </li>
      </ul>
      <div v-if="workspaceUnreadable" class="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm" data-testid="glance-unreadable">
        <span class="text-muted">{{ t('vendor.customers.glance.unreadableHint') }}</span>
        <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-refresh-cw" @click="emit('retry')">{{ t('app.retry') }}</UButton>
      </div>
    </section>

    <div class="grid gap-4 sm:grid-cols-2">
      <SharedMetricTile icon="i-lucide-package" :label="t('vendor.customers.plan')" :value="planName ?? t('vendor.customers.noPlan')" :hint="planPending ? t('vendor.customers.pendingActivation') : sub?.applied ? cadenceLabel(sub.applied.cadence, t) : undefined">
        <div v-if="display" class="mt-1"><SharedStatusBadge :tone="customerDisplayBadge(display).tone" :label="t(customerDisplayBadge(display).labelKey)" /></div>
        <NuxtLink :to="tabTo('subscription')" class="text-sm text-primary hover:underline">{{ t('vendor.customers.glance.view') }}</NuxtLink>
      </SharedMetricTile>

      <SharedMetricTile icon="i-lucide-calendar-clock" :label="t('vendor.customers.glance.renewal')" :value="renewal?.date" value-dir="ltr" :hint="renewal?.hint ?? t('vendor.customers.glance.noRenewal')">
        <NuxtLink :to="tabTo('subscription')" class="text-sm text-primary hover:underline">{{ t('vendor.customers.glance.view') }}</NuxtLink>
      </SharedMetricTile>

      <SharedMetricTile v-if="invoices !== undefined" icon="i-lucide-receipt" :label="t('vendor.customers.glance.lastInvoice')" :value="lastInvoice ? formatCommercialMoney(lastInvoice.total, locale) : null" value-dir="ltr" :hint="lastInvoice ? undefined : t('vendor.customers.glance.noInvoices')">
        <div v-if="lastInvoice" class="mt-1"><SharedStatusBadge :tone="invoiceStatusBadge(lastInvoice.status, 'vendor.invoices.status').tone" :label="t(invoiceStatusBadge(lastInvoice.status, 'vendor.invoices.status').labelKey)" /></div>
        <NuxtLink :to="tabTo('invoices')" class="text-sm text-primary hover:underline">{{ t('vendor.customers.glance.view') }}</NuxtLink>
      </SharedMetricTile>

      <SharedMetricTile icon="i-lucide-server" :label="t('vendor.customers.sections.workspace')" :value="workspaceBadge ? t(workspaceBadge.labelKey) : t('vendor.customers.noWorkspace')">
        <div class="mt-1 flex flex-wrap items-center gap-3">
          <UButton v-if="loginUrl" :to="loginUrl" external target="_blank" rel="noopener noreferrer" size="sm" icon="i-lucide-external-link">{{ t('vendor.customers.openWorkspace') }}</UButton>
          <NuxtLink v-if="hasWorkspace" :to="tabTo('workspace')" class="text-sm text-primary hover:underline">{{ t('vendor.customers.glance.view') }}</NuxtLink>
        </div>
      </SharedMetricTile>
    </div>
  </div>
</template>
