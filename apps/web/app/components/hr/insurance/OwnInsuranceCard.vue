<script setup lang="ts">
import type { HrInsuranceOwnEnrollment } from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { hrInsuranceEnrollmentBadge } from '@/utils/hrInsurance'

// The signed-in employee's own coverage: plan, dates, member number and their dependents when the company's
// policy shows them. Read-only; the notes HR keeps never reach this card.
const props = defineProps<{ enrollment: HrInsuranceOwnEnrollment }>()
const { t, locale } = useI18n()
const badge = computed(() => hrInsuranceEnrollmentBadge(props.enrollment.state))
const number = (value: number) => new Intl.NumberFormat(locale.value).format(value)
</script>

<template>
  <SharedRecordSection variant="panel" :title="props.enrollment.plan.name" :data-testid="`hr-own-insurance-${props.enrollment.id}`">
    <div class="grid gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <SharedStatusBadge size="sm" :tone="badge.tone" :label="t(badge.labelKey)" data-testid="hr-own-insurance-state" />
        <span class="text-sm text-muted">{{ props.enrollment.plan.provider.name }}<template v-if="props.enrollment.plan.tier"> · {{ props.enrollment.plan.tier }}</template></span>
      </div>
      <dl class="grid gap-x-6 sm:grid-cols-2">
        <SharedPropertyRow :label="t('hrInsurance.own.coverage')" :value="`${formatDate(props.enrollment.date_from)} – ${formatDate(props.enrollment.date_end)}`" />
        <SharedPropertyRow :label="t('hrInsurance.own.memberNumber')">
          <bdi v-if="props.enrollment.member_number" dir="ltr" data-testid="hr-own-insurance-member">{{ props.enrollment.member_number }}</bdi>
        </SharedPropertyRow>
        <SharedPropertyRow v-if="props.enrollment.employee_share !== null" :label="t('hrInsurance.own.employeeShare')" :value="number(props.enrollment.employee_share)" />
        <SharedPropertyRow v-if="props.enrollment.company_share !== null" :label="t('hrInsurance.own.companyShare')" :value="number(props.enrollment.company_share)" />
      </dl>
      <div v-if="props.enrollment.dependents_visible">
        <p class="text-xs font-semibold text-muted">{{ t('hrInsurance.dependents.title') }}</p>
        <p v-if="!props.enrollment.dependents.length" class="text-sm text-muted">{{ t('hrInsurance.own.noDependents') }}</p>
        <ul v-else class="mt-1 grid gap-2" data-testid="hr-own-insurance-dependents">
          <li v-for="row in props.enrollment.dependents" :key="row.id" class="flex flex-wrap items-baseline justify-between gap-2">
            <span class="font-semibold text-highlighted">{{ row.name }} <span class="font-normal text-muted">· {{ t(`hrInsurance.relation.${row.relation}`) }}</span></span>
            <span class="tabular-nums text-sm text-muted">{{ formatDate(row.date_from) }} – {{ row.date_to ? formatDate(row.date_to) : t('hrInsurance.untilPlanEnd') }}</span>
          </li>
        </ul>
      </div>
    </div>
  </SharedRecordSection>
</template>
