<script setup lang="ts">
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'

// The figures above /hr/insurance: active members, plans about to end and employees without cover.
// Counts only, straight from the server's summary; no names and no numbers.
const { t } = useI18n()
const summary = useHrInsuranceSummary()
const tiles = computed<KpiTile[]>(() => {
  const data = summary.data.value
  if (!data) return []
  return [
    { id: 'members', label: t('hrInsurance.kpi.members'), value: data.active_members, icon: 'i-lucide-heart-pulse', hint: t('hrInsurance.kpi.membersHint', { enrollments: data.active_enrollments, dependents: data.active_dependents }) },
    { id: 'expiring', label: t('hrInsurance.kpi.expiring'), value: data.expiring_plans, icon: 'i-lucide-hourglass', tone: data.expiring_plans ? 'warning' : 'neutral', hint: t('hrInsurance.kpi.expiringHint', { days: data.expiry_alert_days }, data.expiry_alert_days) },
    { id: 'uncovered', label: t('hrInsurance.kpi.uncovered'), value: data.employees_without_insurance, icon: 'i-lucide-shield-off', tone: data.employees_without_insurance ? 'warning' : 'success' },
  ]
})
</script>

<template>
  <SharedKpiStrip :tiles="tiles" :loading="summary.isLoading.value" :skeleton-count="3" :label="t('hrInsurance.kpi.label')" data-testid="hr-insurance-kpis" />
</template>
