<script setup lang="ts">
import type { TenantDeletionRun } from '@liwan/commercial-contracts'
import { formatLiwanDateTime } from '@liwan/ui/app/composables/calendarDate'
import { deletionCheckKey, deletionCodeText, stuckParts } from '@/utils/vendorDeletion'
// Read-only: the frozen plan, the pre-checks as they stand now and the step ledger of one workspace deletion. The vendor's only act on a deletion is the withdrawal, which the customer page owns.
const props = defineProps<{ run: TenantDeletionRun }>()
const { t } = useI18n()
const dateTime = (value: string | null) => (value ? formatLiwanDateTime(value) : '')
const stuck = computed(() => stuckParts(props.run.request))
/** A runner code as a sentence: a known cause, an unmet check, or one generic line that keeps the raw code for support. */
const codeText = (code: string) => {
  const text = deletionCodeText(code)
  return t(text.key, { ...(text.check ? { check: t(text.check) } : {}), ...(text.code ? { code: text.code } : {}) })
}
const checkText = (code: string) => { const key = deletionCheckKey(code); return key ? t(key) : code }
const stuckStep = computed(() => (stuck.value?.step ? t(`vendor.customers.deletion.run.stepNames.${stuck.value.step}`) : ''))
const dates = computed(() => [
  ['holdUntil', props.run.request.hold_until], ['deletingAt', props.run.request.deleting_at],
  ['committedAt', props.run.request.committed_at], ['deletedAt', props.run.request.deleted_at],
] as const)
</script>

<template>
  <div class="space-y-4" data-testid="deletion-run">
    <p class="text-sm text-muted" data-testid="deletion-runner-state">{{ t(run.enabled ? 'vendor.customers.deletion.run.runnerOn' : 'vendor.customers.deletion.run.runnerOff') }}<template v-if="!run.enabled && run.disabled_reason"> {{ t(`vendor.customers.deletion.run.runnerOffReasons.${run.disabled_reason}`) }}</template></p>
    <UAlert v-if="run.restore_hold_until" color="warning" variant="subtle" icon="i-lucide-history" data-testid="deletion-restore-hold" :title="t('vendor.customers.deletion.run.restoreHold')" :description="dateTime(run.restore_hold_until)" />
    <UAlert v-if="stuck" color="error" variant="subtle" icon="i-lucide-octagon-alert" data-testid="deletion-stuck" :title="t('vendor.customers.deletion.run.stuck', { step: stuckStep, reason: codeText(stuck.code) })" />
    <SharedPropertiesPanel :title="t('vendor.customers.deletion.run.title')">
      <template v-for="[key, value] in dates" :key="key">
        <SharedPropertyRow v-if="value" :label="t(`vendor.customers.deletion.run.${key}`)"><bdi dir="ltr">{{ dateTime(value) }}</bdi></SharedPropertyRow>
      </template>
    </SharedPropertiesPanel>
    <p v-if="run.request.state === 'deleting'" class="text-sm text-muted" data-testid="deletion-point-of-no-return">{{ t(run.request.committed_at ? 'vendor.customers.deletion.run.committed' : 'vendor.customers.deletion.run.notCommitted') }}</p>
    <SharedPropertiesPanel :title="t('vendor.customers.deletion.run.planTitle')">
      <template v-if="run.plan">
        <SharedPropertyRow :label="t('vendor.customers.deletion.run.planDatabase')"><bdi dir="ltr">{{ run.plan.database }}</bdi></SharedPropertyRow>
        <SharedPropertyRow :label="t('vendor.customers.deletion.run.planHost')"><bdi dir="ltr">{{ run.plan.host }}</bdi></SharedPropertyRow>
        <SharedPropertyRow :label="t('vendor.customers.deletion.run.planBackups')" :value="String(run.plan.backups)" />
        <SharedPropertyRow :label="t('vendor.customers.deletion.run.planRestoreCopies')" :value="String(run.plan.restore_copies)" />
        <SharedPropertyRow :label="t('vendor.customers.deletion.run.planCards')" :value="String(run.plan.cards)" />
      </template>
      <p v-else class="text-sm text-muted" data-testid="deletion-no-plan">{{ t('vendor.customers.deletion.run.noPlan') }}</p>
    </SharedPropertiesPanel>
    <section v-if="run.prechecks.checks.length" class="space-y-2" data-testid="deletion-prechecks" :aria-label="t('vendor.customers.deletion.run.prechecksTitle')">
      <h3 class="text-sm font-semibold">{{ t('vendor.customers.deletion.run.prechecksTitle') }}</h3>
      <p class="text-sm text-muted">{{ run.prechecks.blocked_by ? t('vendor.customers.deletion.run.prechecksBlocked', { reason: codeText(run.prechecks.blocked_by) }) : t('vendor.customers.deletion.run.prechecksClear') }}</p>
      <ul class="space-y-1 text-sm">
        <li v-for="check in run.prechecks.checks" :key="check.code" class="flex items-center gap-2" data-testid="deletion-precheck" :data-ok="check.ok">
          <SharedStatusBadge :tone="check.ok ? 'success' : 'destructive'" :label="t(check.ok ? 'vendor.customers.deletion.run.checkOk' : 'vendor.customers.deletion.run.checkFailing')" />
          <span>{{ checkText(check.code) }}</span>
        </li>
      </ul>
    </section>
    <section class="space-y-2" :aria-label="t('vendor.customers.deletion.run.stepsTitle')">
      <h3 class="text-sm font-semibold">{{ t('vendor.customers.deletion.run.stepsTitle') }}</h3>
      <p v-if="!run.steps.length" class="text-sm text-muted" data-testid="deletion-no-steps">{{ t('vendor.customers.deletion.run.noSteps') }}</p>
      <ol v-else class="space-y-2">
        <li v-for="step in run.steps" :key="step.step" class="rounded-lg border border-default p-3 text-sm" data-testid="deletion-step" :data-step="step.step" :data-state="step.state">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-medium">{{ t(`vendor.customers.deletion.run.stepNames.${step.step}`) }}</span>
            <SharedStatusBadge :tone="step.state === 'done' ? 'success' : step.state === 'failed' ? 'destructive' : step.state === 'running' ? 'info' : 'neutral'" :label="t(`vendor.customers.deletion.run.states.${step.state}`)" />
          </div>
          <p class="mt-1 text-muted">{{ t('vendor.customers.deletion.run.attemptsLine', { attempts: t('vendor.customers.deletion.run.attempts', { count: step.attempts }, step.attempts), failures: t('vendor.customers.deletion.run.failures', { count: step.failures }, step.failures) }) }}</p>
          <p v-if="step.error_code" class="mt-1" data-testid="deletion-step-error">{{ t('vendor.customers.deletion.run.lastError', { reason: codeText(step.error_code) }) }}</p>
          <p v-if="step.next_attempt_at" class="mt-1 text-muted">{{ t('vendor.customers.deletion.run.nextAttempt', { date: dateTime(step.next_attempt_at) }) }}</p>
        </li>
      </ol>
    </section>
  </div>
</template>
