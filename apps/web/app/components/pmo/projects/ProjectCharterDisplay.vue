<script setup lang="ts">
import type { CharterDraft, CharterMilestone } from '@/utils/projectCharter'
import { aggregateMilestoneOutputs } from '@/utils/projectCharter'
import { formatCalendarDate } from '@nasq/ui/app/composables/calendarDate'

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
        <UButton type="button" color="neutral" variant="outline" size="sm" :label="t('projects.charter.retryMilestones')" @click="emit('retryMilestones')" />
      </template>
    </UAlert>

    <div class="grid gap-4 lg:grid-cols-3 lg:items-start">
      <div class="grid min-w-0 gap-4 lg:col-span-2">
        <SharedRecordSection panel id="project-charter-essentials" :title="t('projects.charter.sections.essentials')">
          <template #actions>
            <slot name="state" />
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              class="print:hidden"
              data-testid="project-charter-print"
              :disabled="!milestonesReady"
              :title="!milestonesReady ? t('projects.charter.printUnavailable') : undefined"
              :label="t('projects.charter.print')"
              @click="printCharter"
            />
            <slot name="actions" />
          </template>
          <dl class="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <div data-testid="charter-display-name"><dt class="text-xs text-muted">{{ t('projects.charter.fields.name') }}</dt><dd class="mt-1 text-sm text-default">{{ draft.name }}</dd></div>
            <div v-if="draft.code" data-testid="charter-display-code"><dt class="text-xs text-muted">{{ t('projects.charter.fields.code') }}</dt><dd class="mt-1 text-sm text-default"><bdi dir="ltr" class="font-mono">{{ draft.code }}</bdi></dd></div>
            <div v-if="draft.managerName?.trim()"><dt class="text-xs text-muted">{{ t('projects.charter.fields.manager') }}</dt><dd class="mt-1 text-sm text-default">{{ draft.managerName }}</dd></div>
            <div v-if="draft.dateStart"><dt class="text-xs text-muted">{{ t('projects.charter.fields.date_start') }}</dt><dd class="mt-1 text-sm text-default">{{ date(draft.dateStart) }}</dd></div>
            <div v-if="draft.dateEnd"><dt class="text-xs text-muted">{{ t('projects.charter.fields.date_end') }}</dt><dd class="mt-1 text-sm text-default">{{ date(draft.dateEnd) }}</dd></div>
            <div v-if="draft.description.trim()" class="sm:col-span-2"><dt class="text-xs text-muted">{{ t('projects.charter.fields.description') }}</dt><dd v-if="/<\/?[a-z][\s\S]*>/i.test(draft.description)" class="mt-1"><SharedRichText size="sm" :html="draft.description" /></dd><dd v-else class="mt-1 whitespace-pre-wrap text-sm text-default">{{ draft.description }}</dd></div>
          </dl>
        </SharedRecordSection>

        <SharedRecordSection v-if="draft.rationale.trim()" panel id="project-charter-purpose" :title="t('projects.charter.sections.purpose')">
          <p class="whitespace-pre-wrap text-sm">{{ draft.rationale }}</p>
        </SharedRecordSection>

        <SharedRecordSection v-if="visibleObjectives.length" panel id="project-charter-objectives" :title="t('projects.charter.fields.objectives')">
          <ul class="grid gap-3 sm:grid-cols-2">
            <li v-for="row in visibleObjectives" :key="row.key" class="rounded-md bg-elevated/50 p-3">
              <dl class="grid gap-2 text-sm">
                <div v-if="row.goal.trim()"><dt class="text-muted">{{ t('projects.charter.fields.objectiveGoal') }}</dt><dd>{{ row.goal }}</dd></div>
                <div v-if="row.metric.trim()"><dt class="text-muted">{{ t('projects.charter.fields.objectiveMetric') }}</dt><dd>{{ row.metric }}</dd></div>
                <div v-if="row.target.trim()"><dt class="text-muted">{{ t('projects.charter.fields.objectiveTarget') }}</dt><dd>{{ row.target }}</dd></div>
              </dl>
            </li>
          </ul>
        </SharedRecordSection>

        <SharedRecordSection v-if="draft.scope.trim() || draft.exclusions.trim()" panel id="project-charter-scope" :title="t('projects.charter.sections.scope')">
          <dl class="grid gap-4 sm:grid-cols-2">
            <div v-if="draft.scope.trim()"><dt class="text-xs text-muted">{{ t('projects.charter.fields.scope') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ draft.scope }}</dd></div>
            <div v-if="draft.exclusions.trim()"><dt class="text-xs text-muted">{{ t('projects.charter.fields.exclusions') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ draft.exclusions }}</dd></div>
          </dl>
        </SharedRecordSection>

        <SharedRecordSection v-if="milestoneOutputs.length" panel data-testid="charter-milestone-outputs" id="charter-milestone-outputs" :title="t('projects.charter.milestoneOutputs')">
          <ul class="grid gap-2 rounded-md bg-elevated/50 p-3">
            <li v-for="(output, index) in milestoneOutputs" :key="`${output.milestoneId}-${index}`" class="flex flex-wrap items-center gap-2 text-sm">
              <label class="flex min-w-0 items-center gap-2">
                <UCheckbox :model-value="output.done" disabled :aria-label="output.name" />
                <span class="truncate">{{ output.name }}</span>
              </label>
              <span class="text-muted">{{ output.milestoneName }}</span>
            </li>
          </ul>
        </SharedRecordSection>

        <UCollapsible v-if="hasLegacyDetails" class="rounded-lg bg-default ring ring-default" data-testid="charter-legacy-details">
          <UButton
            color="neutral"
            variant="ghost"
            block
            class="group justify-between p-4 font-semibold text-highlighted"
            trailing-icon="i-lucide-chevron-down"
            :ui="{ trailingIcon: 'transition-transform group-data-[state=open]:rotate-180' }"
            :label="t('projects.charter.legacyDetails')"
          />
          <template #content>
          <div class="grid gap-6 p-4 pt-0">
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
          </template>
        </UCollapsible>
      </div>

      <div class="grid min-w-0 gap-4">
        <SharedRecordSection panel id="project-charter-budget" :title="t('projects.charter.sections.planning')">
          <dl class="grid gap-4">
            <div><dt class="text-xs text-muted">{{ t('projects.charter.fields.budget_state') }}</dt><dd class="mt-1 text-sm text-default">{{ t(`projects.charter.budget.${draft.budgetState}`) }}</dd></div>
            <div v-if="budgetAmount()"><dt class="text-xs text-muted">{{ t('projects.charter.fields.amount') }}</dt><dd class="mt-1 text-sm text-default">{{ budgetAmount() }}<span v-if="draft.currencyLabel"> {{ draft.currencyLabel }}</span></dd></div>
          </dl>
        </SharedRecordSection>
      </div>
    </div>
  </article>
</template>
