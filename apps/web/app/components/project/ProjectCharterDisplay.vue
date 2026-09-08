<script setup lang="ts">
import type { CharterDraft } from '@/utils/projectCharter'
import { formatCalendarDate } from '@/composables/calendarDate'
import { sanitizeHtml } from '@/utils/sanitize'

const props = defineProps<{ draft: CharterDraft }>()
const { t, locale } = useI18n()

function display(value: string | null | undefined): string {
  return value?.trim() || t('projects.charter.none')
}

function date(value: string | null): string {
  return value ? formatCalendarDate(value, locale.value) || value : t('projects.charter.none')
}

function budgetAmount(): string {
  if (props.draft.budgetState === 'unknown') return t('projects.charter.budget.unknown')
  return display(props.draft.amountInput)
}
</script>

<template>
  <article data-testid="project-charter-display" class="grid gap-8" aria-labelledby="project-charter-document-title">
    <section class="grid gap-4" aria-labelledby="project-charter-document-title">
      <h2 id="project-charter-document-title" class="text-base font-semibold">{{ t('projects.charter.sections.essentials') }}</h2>
      <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <div data-testid="charter-display-name"><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.name') }}</dt><dd class="mt-1 text-lg font-semibold">{{ display(draft.name) }}</dd></div>
        <div data-testid="charter-display-code"><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.code') }}</dt><dd class="mt-1 font-mono text-sm" dir="ltr">{{ display(draft.code) }}</dd></div>
        <div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.description') }}</dt><dd v-if="/<\/?[a-z][\s\S]*>/i.test(draft.description)" class="mt-1 whitespace-pre-wrap text-sm" v-html="sanitizeHtml(draft.description)" /><dd v-else class="mt-1 whitespace-pre-wrap text-sm">{{ display(draft.description) }}</dd></div>
        <div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.manager') }}</dt><dd class="mt-1 text-sm">{{ display(draft.managerName) }}</dd></div>
        <div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.date_start') }}</dt><dd class="mt-1 text-sm">{{ date(draft.dateStart) }}</dd></div>
        <div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.date_end') }}</dt><dd class="mt-1 text-sm">{{ date(draft.dateEnd) }}</dd></div>
      </dl>
    </section>

    <section class="grid gap-4" aria-labelledby="project-charter-context-title">
      <h2 id="project-charter-context-title" class="text-base font-semibold">{{ t('projects.charter.sections.context') }}</h2>
      <dl class="grid gap-4 sm:grid-cols-2">
        <div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.type') }}</dt><dd class="mt-1 text-sm">{{ display(draft.typeName) }}</dd></div>
        <div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.owning_unit') }}</dt><dd class="mt-1 text-sm">{{ display(draft.owningUnitName) }}</dd></div>
        <div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.sponsor') }}</dt><dd class="mt-1 text-sm">{{ display(draft.sponsorName) }}</dd></div>
        <div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.authority') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ display(draft.authority) }}</dd></div>
        <div class="sm:col-span-2"><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.rationale') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ display(draft.rationale) }}</dd></div>
      </dl>
    </section>

    <section class="grid gap-4" aria-labelledby="project-charter-outcomes-title">
      <h2 id="project-charter-outcomes-title" class="text-base font-semibold">{{ t('projects.charter.sections.outcomes') }}</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <div><h3 class="text-sm font-medium">{{ t('projects.charter.fields.objectives') }}</h3><ul v-if="draft.objectives.some(row => row.goal.trim() || row.metric.trim() || row.target.trim())" class="mt-2 grid gap-3"><li v-for="row in draft.objectives.filter(item => item.goal.trim() || item.metric.trim() || item.target.trim())" :key="row.key" class="rounded-md bg-muted/30 p-3"><dl class="grid gap-2 text-sm"><div><dt class="text-muted-foreground">{{ t('projects.charter.fields.objectiveGoal') }}</dt><dd>{{ display(row.goal) }}</dd></div><div><dt class="text-muted-foreground">{{ t('projects.charter.fields.objectiveMetric') }}</dt><dd>{{ display(row.metric) }}</dd></div><div><dt class="text-muted-foreground">{{ t('projects.charter.fields.objectiveTarget') }}</dt><dd>{{ display(row.target) }}</dd></div></dl></li></ul><p v-else class="mt-2 text-sm text-muted-foreground">{{ t('projects.charter.none') }}</p></div>
        <div><h3 class="text-sm font-medium">{{ t('projects.charter.fields.deliverables') }}</h3><ul v-if="draft.deliverables.some(row => row.name.trim() || row.description.trim() || row.acceptance.trim())" class="mt-2 grid gap-3"><li v-for="row in draft.deliverables.filter(item => item.name.trim() || item.description.trim() || item.acceptance.trim())" :key="row.key" class="rounded-md bg-muted/30 p-3"><dl class="grid gap-2 text-sm"><div><dt class="text-muted-foreground">{{ t('projects.charter.fields.deliverableName') }}</dt><dd>{{ display(row.name) }}</dd></div><div><dt class="text-muted-foreground">{{ t('projects.charter.fields.deliverableDescription') }}</dt><dd class="whitespace-pre-wrap">{{ display(row.description) }}</dd></div><div><dt class="text-muted-foreground">{{ t('projects.charter.fields.acceptance') }}</dt><dd class="whitespace-pre-wrap">{{ display(row.acceptance) }}</dd></div></dl></li></ul><p v-else class="mt-2 text-sm text-muted-foreground">{{ t('projects.charter.none') }}</p></div>
      </div>
      <dl class="grid gap-4 sm:grid-cols-2"><div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.benefits') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ display(draft.benefits) }}</dd></div><div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.scope') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ display(draft.scope) }}</dd></div><div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.exclusions') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ display(draft.exclusions) }}</dd></div><div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.high_level_requirements') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ display(draft.highLevelRequirements) }}</dd></div><div class="sm:col-span-2"><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.success') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ display(draft.success) }}</dd></div></dl>
    </section>

    <section class="grid gap-4" aria-labelledby="project-charter-planning-title">
      <h2 id="project-charter-planning-title" class="text-base font-semibold">{{ t('projects.charter.sections.planning') }}</h2>
      <dl class="grid gap-4 sm:grid-cols-2"><div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.budget_state') }}</dt><dd class="mt-1 text-sm">{{ t(`projects.charter.budget.${draft.budgetState}`) }}</dd></div><div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.amount') }}</dt><dd class="mt-1 text-sm">{{ budgetAmount() }}<span v-if="draft.currencyLabel && draft.budgetState === 'estimate'"> {{ draft.currencyLabel }}</span></dd></div><div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.priority') }}</dt><dd class="mt-1 text-sm">{{ draft.priority ? t(`projects.charter.priority.${draft.priority}`) : t('projects.charter.none') }}</dd></div><div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.assumptions') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ display(draft.assumptions) }}</dd></div><div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.constraints') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ display(draft.constraints) }}</dd></div><div><dt class="text-sm text-muted-foreground">{{ t('projects.charter.fields.closure') }}</dt><dd class="mt-1 whitespace-pre-wrap text-sm">{{ display(draft.closure) }}</dd></div></dl>
    </section>
  </article>
</template>
