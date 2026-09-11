<script setup lang="ts">
import type { CharterDraft, CharterMilestone } from '@/utils/projectCharter'
import { aggregateMilestoneOutputs } from '@/utils/projectCharter'
import { formatCalendarDate } from '@/composables/calendarDate'
import { sanitizeHtml } from '@/utils/sanitize'

const props = defineProps<{
  draft: CharterDraft
  milestones?: readonly CharterMilestone[]
  milestonesLoading?: boolean
  milestonesError?: unknown
}>()
const emit = defineEmits<{ retryMilestones: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()

const milestoneOutputs = computed(() => aggregateMilestoneOutputs(props.milestones ?? []))
const legacyDeliverables = computed(() => props.draft.deliverables.filter(row => row.name.trim() || row.description.trim() || row.acceptance.trim()))
const visibleObjectives = computed(() => props.draft.objectives.filter(row => row.goal.trim() || row.metric.trim() || row.target.trim()))
const hasLegacyDetails = computed(() => Boolean(
  props.draft.typeName?.trim()
  || props.draft.owningUnitName?.trim()
  || props.draft.sponsorName?.trim()
  || props.draft.authority.trim()
  || props.draft.benefits.trim()
  || props.draft.highLevelRequirements.trim()
  || props.draft.success.trim()
  || props.draft.priority
  || props.draft.assumptions.trim()
  || props.draft.constraints.trim()
  || props.draft.closure.trim()
  || legacyDeliverables.value.length,
))
const milestonesReady = computed(() => hydrated.value && !props.milestonesLoading && !props.milestonesError)

function printCharter() {
  if (milestonesReady.value && typeof window !== 'undefined') window.print()
}

function date(value: string | null): string {
  return value ? formatCalendarDate(value, locale.value) || value : ''
}

function budgetAmount(): string {
  return props.draft.budgetState === 'estimate' ? props.draft.amountInput.trim() : ''
}
</script>

<template>
  <article data-testid="project-charter-display" class="grid gap-4" aria-labelledby="project-charter-essentials-title">
    <div v-if="milestonesLoading" role="status" data-testid="charter-milestones-loading" class="text-sm text-muted">
      {{ t('projects.charter.milestonesLoading') }}
    </div>
    <UAlert
      v-else-if="milestonesError"
      color="error"
      variant="soft"
      data-testid="charter-milestones-error"
      :title="t('projects.charter.milestonesError')"
    >
      <template #actions>
        <UButton type="button" color="secondary" variant="solid" size="sm" :label="t('projects.charter.retryMilestones')" @click="emit('retryMilestones')" />
      </template>
    </UAlert>

    <UCard aria-labelledby="project-charter-essentials-title">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 id="project-charter-essentials-title" class="text-lg font-semibold text-highlighted">{{ t('projects.charter.sections.essentials') }}</h2>
          <UButton
            type="button"
            color="secondary"
            variant="solid"
            class="print:hidden"
            data-testid="project-charter-print"
            :disabled="!milestonesReady"
            :title="!milestonesReady ? t('projects.charter.printUnavailable') : undefined"
            :label="t('projects.charter.print')"
            @click="printCharter"
          />
        </div>
      </template>
      <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <div data-testid="charter-display-name"><dt class="text-sm text-muted">{{ t('projects.charter.fields.name') }}</dt><dd class="mt-1 text-lg font-semibold text-highlighted">{{ draft.name }}</dd></div>
        <div v-if="draft.code" data-testid="charter-display-code"><dt class="text-sm text-muted">{{ t('projects.charter.fields.code') }}</dt><dd class="mt-1 font-mono text-sm" dir="ltr">{{ draft.code }}</dd></div>
        <div v-if="draft.description.trim()" class="sm:col-span-2"><dt class="text-sm text-muted">{{ t('projects.charter.fields.description') }}</dt><dd v-if="/<\/?[a-z][\s\S]*>/i.test(draft.description)" class="mt-1 whitespace-pre-wrap text-sm" v-html="sanitizeHtml(draft.description)" /><dd v-else class="mt-1 whitespace-pre-wrap text-sm">{{ draft.description }}</dd></div>
        <div v-if="draft.managerName?.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.manager') }}</dt><dd class="mt-1 text-sm">{{ draft.managerName }}</dd></div>
        <div v-if="draft.dateStart"><dt class="text-sm text-muted">{{ t('projects.charter.fields.date_start') }}</dt><dd class="mt-1 text-sm">{{ date(draft.dateStart) }}</dd></div>
        <div v-if="draft.dateEnd"><dt class="text-sm text-muted">{{ t('projects.charter.fields.date_end') }}</dt><dd class="mt-1 text-sm">{{ date(draft.dateEnd) }}</dd></div>
      </dl>
    </UCard>

    <UCard v-if="draft.rationale.trim()" aria-labelledby="project-charter-purpose-title">
      <template #header>
        <h2 id="project-charter-purpose-title" class="text-lg font-semibold text-highlighted">{{ t('projects.charter.sections.purpose') }}</h2>
      </template>
      <p class="whitespace-pre-wrap text-sm">{{ draft.rationale }}</p>
    </UCard>

    <UCard v-if="visibleObjectives.length" aria-labelledby="project-charter-objectives-title">
      <template #header>
        <h2 id="project-charter-objectives-title" class="text-lg font-semibold text-highlighted">{{ t('projects.charter.fields.objectives') }}</h2>
      </template>
      <ul class="grid gap-3 sm:grid-cols-2">
        <li v-for="row in visibleObjectives" :key="row.key" class="rounded-md bg-elevated/50 p-3">
          <dl class="grid gap-2 text-sm">
            <div v-if="row.goal.trim()"><dt class="text-muted">{{ t('projects.charter.fields.objectiveGoal') }}</dt><dd>{{ row.goal }}</dd></div>
            <div v-if="row.metric.trim()"><dt class="text-muted">{{ t('projects.charter.fields.objectiveMetric') }}</dt><dd>{{ row.metric }}</dd></div>
            <div v-if="row.target.trim()"><dt class="text-muted">{{ t('projects.charter.fields.objectiveTarget') }}</dt><dd>{{ row.target }}</dd></div>
          </dl>
        </li>
      </ul>
    </UCard>

    <UCard v-if="draft.scope.trim() || draft.exclusions.trim()" aria-labelledby="project-charter-scope-title">
      <template #header>
        <h2 id="project-charter-scope-title" class="text-lg font-semibold text-highlighted">{{ t('projects.charter.sections.scope') }}</h2>
      </template>
      <dl class="grid gap-4 sm:grid-cols-2">
        <div v-if="draft.scope.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.scope') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ draft.scope }}</dd></div>
        <div v-if="draft.exclusions.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.exclusions') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ draft.exclusions }}</dd></div>
      </dl>
    </UCard>

    <UCard v-if="milestoneOutputs.length" data-testid="charter-milestone-outputs" aria-labelledby="charter-milestone-outputs-title">
      <template #header>
        <h2 id="charter-milestone-outputs-title" class="text-lg font-semibold text-highlighted">{{ t('projects.charter.milestoneOutputs') }}</h2>
      </template>
      <ul class="grid gap-2 rounded-md bg-elevated/50 p-3">
        <li v-for="(output, index) in milestoneOutputs" :key="`${output.milestoneId}-${index}`" class="flex flex-wrap items-center gap-2 text-sm">
          <label class="flex min-w-0 items-center gap-2">
            <UCheckbox :model-value="output.done" disabled :aria-label="output.name" />
            <span class="truncate">{{ output.name }}</span>
          </label>
          <span class="text-muted">{{ output.milestoneName }}</span>
        </li>
      </ul>
    </UCard>

    <UCard aria-labelledby="project-charter-budget-title">
      <template #header>
        <h2 id="project-charter-budget-title" class="text-lg font-semibold text-highlighted">{{ t('projects.charter.sections.planning') }}</h2>
      </template>
      <dl class="grid gap-4 sm:grid-cols-2">
        <div><dt class="text-sm text-muted">{{ t('projects.charter.fields.budget_state') }}</dt><dd class="mt-1 text-sm">{{ t(`projects.charter.budget.${draft.budgetState}`) }}</dd></div>
        <div v-if="budgetAmount()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.amount') }}</dt><dd class="mt-1 text-sm">{{ budgetAmount() }}<span v-if="draft.currencyLabel"> {{ draft.currencyLabel }}</span></dd></div>
      </dl>
    </UCard>

    <details v-if="hasLegacyDetails" class="rounded-lg border border-default p-4">
      <summary class="cursor-pointer font-semibold text-highlighted">{{ t('projects.charter.legacyDetails') }}</summary>
      <div class="mt-4 grid gap-6">
        <dl class="grid gap-4 sm:grid-cols-2">
          <div v-if="draft.typeName?.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.type') }}</dt><dd class="mt-1 text-sm">{{ draft.typeName }}</dd></div>
          <div v-if="draft.owningUnitName?.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.owning_unit') }}</dt><dd class="mt-1 text-sm">{{ draft.owningUnitName }}</dd></div>
          <div v-if="draft.sponsorName?.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.sponsor') }}</dt><dd class="mt-1 text-sm">{{ draft.sponsorName }}</dd></div>
          <div v-if="draft.authority.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.authority') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ draft.authority }}</dd></div>
          <div v-if="draft.benefits.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.benefits') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ draft.benefits }}</dd></div>
          <div v-if="draft.highLevelRequirements.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.high_level_requirements') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ draft.highLevelRequirements }}</dd></div>
          <div v-if="draft.success.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.success') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ draft.success }}</dd></div>
          <div v-if="draft.priority"><dt class="text-sm text-muted">{{ t('projects.charter.fields.priority') }}</dt><dd class="mt-1 text-sm">{{ t(`projects.charter.priority.${draft.priority}`) }}</dd></div>
          <div v-if="draft.assumptions.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.assumptions') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ draft.assumptions }}</dd></div>
          <div v-if="draft.constraints.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.constraints') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ draft.constraints }}</dd></div>
          <div v-if="draft.closure.trim()"><dt class="text-sm text-muted">{{ t('projects.charter.fields.closure') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ draft.closure }}</dd></div>
        </dl>
        <div v-if="legacyDeliverables.length" class="grid gap-3" data-testid="charter-legacy-deliverables">
          <h3 class="text-sm font-medium">{{ t('projects.charter.legacyDeliverables') }}</h3>
          <ul class="grid gap-3">
            <li v-for="row in legacyDeliverables" :key="row.key" class="rounded-md bg-elevated/50 p-3">
              <dl class="grid gap-2 text-sm">
                <div v-if="row.name.trim()"><dt class="text-muted">{{ t('projects.charter.fields.deliverableName') }}</dt><dd>{{ row.name }}</dd></div>
                <div v-if="row.description.trim()"><dt class="text-muted">{{ t('projects.charter.fields.deliverableDescription') }}</dt><dd class="whitespace-pre-wrap">{{ row.description }}</dd></div>
                <div v-if="row.acceptance.trim()"><dt class="text-muted">{{ t('projects.charter.fields.acceptance') }}</dt><dd class="whitespace-pre-wrap">{{ row.acceptance }}</dd></div>
              </dl>
            </li>
          </ul>
        </div>
      </div>
    </details>
  </article>
</template>
