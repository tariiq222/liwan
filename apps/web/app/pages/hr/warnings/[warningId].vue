<script setup lang="ts">
import WarningStandingNote from '@/components/hr/warnings/WarningStandingNote.vue'
import WarningWithdrawConfirm from '@/components/hr/warnings/WarningWithdrawConfirm.vue'
import { formatDate, formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { ApiError } from '@/composables/useApi'
import { isHrWarningConflict } from '@/composables/useHrWarnings'
import { owningListBack } from '@/utils/recordListOrigin'
import { canIssueHrWarning, canWithdrawHrWarning, hrWarningBadge, hrWarningEvents } from '@/utils/hrWarnings'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/warnings'])
const id = computed(() => Number(route.params.warningId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const query = useHrWarning(computed(() => (validId.value ? id.value : null)))
const warning = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

const canManage = computed(() => can('hr.warnings.manage'))
const standing = useHrWarningStanding(computed(() => warning.value?.employee.id ?? null))
const issue = useIssueHrWarning()
const withdraw = useWithdrawHrWarning()
const writing = computed(() => issue.isPending.value || withdraw.isPending.value)
const withdrawing = ref(false)
const actionError = ref('')

const badge = computed(() => (warning.value ? hrWarningBadge(warning.value.state) : null))
const events = computed(() => (warning.value ? hrWarningEvents(warning.value) : []))
const showIssue = computed(() => !!warning.value && canIssueHrWarning(warning.value, canManage.value))
const showWithdraw = computed(() => !!warning.value && canWithdrawHrWarning(warning.value, canManage.value))

async function run(action: () => Promise<unknown>) {
  if (!hydrated.value || writing.value) return
  actionError.value = ''
  try {
    await action()
  } catch (cause) {
    actionError.value = isHrWarningConflict(cause)
      ? t('hrWarnings.actions.conflict')
      : cause instanceof ApiError ? cause.message : t('errors.generic')
    withdrawing.value = false
  }
}
async function confirmIssue() {
  const current = warning.value
  if (current) await run(() => issue.mutateAsync({ id: current.id, revision: current.revision }))
}
async function confirmWithdraw(reason: string) {
  const current = warning.value
  if (!current) return
  await run(async () => {
    await withdraw.mutateAsync({ id: current.id, revision: current.revision, reason })
    withdrawing.value = false
  })
}
</script>

<template>
  <SharedRecordPage
    :keep-content="!!warning"
    :title="warning ? `${warning.type.name} · ${warning.employee.name}` : t('hrWarnings.title')"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="warning && (showIssue || showWithdraw)" #actions>
      <UButton
        v-if="showIssue"
        color="primary"
        :disabled="!hydrated || writing"
        :loading="issue.isPending.value"
        :label="t('hrWarnings.actions.issue')"
        data-testid="hr-warning-issue"
        @click="confirmIssue"
      />
      <UButton
        v-if="showWithdraw"
        color="error"
        variant="outline"
        :disabled="!hydrated || writing"
        :label="t('hrWarnings.actions.withdraw')"
        data-testid="hr-warning-withdraw"
        @click="withdrawing = true"
      />
    </template>

    <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="t('hrWarnings.actions.error')" :description="actionError" data-testid="hr-warning-action-error" />

    <WarningWithdrawConfirm v-if="withdrawing" :pending="withdraw.isPending.value" @confirm="confirmWithdraw" @cancel="withdrawing = false" />

    <SharedIdentityCard
      v-if="warning"
      :id="warning.id"
      :name="warning.employee.name"
      :subtitle="`${warning.type.name} · ${t('hrWarnings.severity', { severity: warning.type.severity })}`"
    >
      <template v-if="badge" #badge>
        <SharedStatusBadge size="sm" :tone="badge.tone" :label="t(badge.labelKey)" data-testid="hr-warning-state" />
      </template>
    </SharedIdentityCard>

    <WarningStandingNote v-if="warning" :standing="standing.data.value" />

    <SharedRecordSection v-if="warning" variant="panel" :title="t('hrWarnings.detail.reason')">
      <div class="grid gap-4">
        <p class="whitespace-pre-line" data-testid="hr-warning-reason">{{ warning.reason }}</p>
        <div v-if="warning.corrective_action">
          <p class="text-xs font-semibold text-muted">{{ t('hrWarnings.detail.corrective') }}</p>
          <p class="whitespace-pre-line">{{ warning.corrective_action }}</p>
        </div>
        <div v-if="warning.contest_note">
          <p class="text-xs font-semibold text-muted">{{ t('hrWarnings.detail.contestNote') }}</p>
          <p class="whitespace-pre-line" data-testid="hr-warning-contest-note">{{ warning.contest_note }}</p>
        </div>
        <div v-if="warning.withdraw_reason">
          <p class="text-xs font-semibold text-muted">{{ t('hrWarnings.detail.withdrawReason') }}</p>
          <p class="whitespace-pre-line">{{ warning.withdraw_reason }}</p>
        </div>
      </div>
    </SharedRecordSection>

    <SharedRecordSection v-if="warning" variant="panel" :title="t('hrWarnings.detail.history')">
      <p v-if="!events.length" class="text-sm text-muted">{{ t('hrWarnings.detail.noHistory') }}</p>
      <ol v-else class="grid gap-3" data-testid="hr-warning-history">
        <li v-for="event in events" :key="event.kind" class="flex flex-wrap items-baseline justify-between gap-2">
          <span class="font-semibold text-highlighted">
            {{ t(`hrWarnings.event.${event.kind}`) }}
            <span v-if="event.by" class="font-normal text-muted">{{ t('hrWarnings.event.by', { name: event.by }) }}</span>
          </span>
          <span class="tabular-nums text-sm text-muted">{{ formatDateTime(event.at) }}</span>
        </li>
      </ol>
    </SharedRecordSection>

    <template v-if="warning" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('hrWarnings.detail.employee')" :value="warning.employee.name" />
        <SharedPropertyRow :label="t('hrWarnings.detail.type')" :value="warning.type.name" />
        <SharedPropertyRow :label="t('hrWarnings.detail.date')" :value="formatDate(warning.date_issued)" />
        <SharedPropertyRow :label="t('hrWarnings.detail.answerMode')" :value="t(`hrWarnings.answerMode.${warning.acknowledgement}`)" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
