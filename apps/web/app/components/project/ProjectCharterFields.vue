<script setup lang="ts">
import type { ProjectCharterCatalogResource } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import { formatCalendarDate } from '@/composables/calendarDate'
import { usePeople } from '@/composables/usePeople'
import { useCharterCatalogSearch } from '@/composables/useProjectCharterCatalogs'
import type { CharterDraft, CharterFieldKey } from '@/utils/projectCharter'
import { CHARTER_FIELD_KEYS, PROJECT_PRIORITIES } from '@/utils/projectCharter'
import { charterStepsForType } from '@/utils/charterSteps'
import { returnToQuery } from '@/utils/safeReturnTo'
import { sanitizeHtml } from '@/utils/sanitize'
import ProjectCharterRows from '@/components/project/ProjectCharterRows.vue'
import ProjectFieldHelp from '@/components/project/ProjectFieldHelp.vue'

const draft = defineModel<CharterDraft>({ required: true })
const props = defineProps<{
  readonly?: boolean
  disabled?: boolean
  fieldErrors?: Partial<Record<CharterFieldKey, string>>
  requireManager?: boolean
  requireEndDate?: boolean
  // The charter wizard renders one step at a time: only these fields show.
  // Absent, every field renders (the full single-surface form).
  fields?: readonly CharterFieldKey[]
}>()

const { t, locale } = useI18n()
const { can } = useAccess()
const route = useRoute()
const hydrated = useHydrated()
const canManageSettings = computed(() => can('pmo.settings.manage'))
const controlsDisabled = computed(() => props.disabled || !hydrated.value)
const visible = computed(() => new Set<CharterFieldKey>(props.fields ?? CHARTER_FIELD_KEYS))
function show(field: CharterFieldKey): boolean {
  return visible.value.has(field)
}

const managerOpen = ref(false)
const managerQ = ref('')
const debouncedManagerQ = refDebounced(managerQ, 250)
const { data: managers } = usePeople(debouncedManagerQ)

const sponsorOpen = ref(false)
const sponsorQ = ref('')
const debouncedSponsorQ = refDebounced(sponsorQ, 250)
const { data: sponsors } = usePeople(debouncedSponsorQ)

const typeOpen = ref(false)
const unitOpen = ref(false)
const {
  q: typeQuery,
  items: typeItems,
  pending: typesPending,
  hasMore: typesHasMore,
  loadMore: loadMoreTypes,
} = useCharterCatalogSearch('types', computed(() => !props.readonly && show('type')))
const {
  q: unitQuery,
  items: unitItems,
  pending: unitsPending,
  hasMore: unitsHasMore,
  loadMore: loadMoreUnits,
} = useCharterCatalogSearch('owning-units', computed(() => !props.readonly && show('owning_unit')))

function helpLabel(field: string): string {
  return t('projects.charter.helpAria', { field })
}

function catalogSettingsPath(resource: ProjectCharterCatalogResource) {
  return { path: `/settings/projects/catalogs/${resource}`, query: returnToQuery(route.fullPath) }
}

function selectManager(userId: number | null, name: string | null) {
  managerOpen.value = false
  managerQ.value = ''
  draft.value.userId = userId
  draft.value.managerName = name
}

function selectSponsor(userId: number | null, name: string | null) {
  sponsorOpen.value = false
  sponsorQ.value = ''
  draft.value.sponsorId = userId
  draft.value.sponsorName = name
}

function selectType(item: { id: number | null; name: string; charter_steps?: readonly string[] } | undefined) {
  typeOpen.value = false
  typeQuery.value = ''
  draft.value.typeId = item?.id ?? null
  draft.value.typeName = item?.id != null ? item.name : null
  // The chosen classification decides which steps the charter walks. A type
  // outside the current search results keeps the steps already on the draft.
  if (item?.id == null) draft.value.typeSteps = null
  else if (item.charter_steps) draft.value.typeSteps = [...item.charter_steps] as CharterDraft['typeSteps']
}

function selectUnit(id: number | null, name: string | null) {
  unitOpen.value = false
  unitQuery.value = ''
  draft.value.owningUnitId = id
  draft.value.owningUnitName = name
}

// USelectMenu can only show a label for an item present in `:items`; the
// currently chosen person/catalog value may fall outside the active search
// results, so it is always merged in to keep the trigger label correct.
const managerItems = computed(() => {
  const list = managers.value ?? []
  const none = props.requireManager ? [] : [{ id: null as number | null, name: t('projects.settings.noManager') }]
  const current = draft.value.userId != null && !list.some(person => person.id === draft.value.userId)
    ? [{ id: draft.value.userId, name: draft.value.managerName ?? '' }]
    : []
  return [...none, ...current, ...list]
})
function onManagerSelect(userId: number | null) {
  selectManager(userId, managerItems.value.find(item => item.id === userId)?.name ?? null)
}

const sponsorItems = computed(() => {
  const list = sponsors.value ?? []
  const current = draft.value.sponsorId != null && !list.some(person => person.id === draft.value.sponsorId)
    ? [{ id: draft.value.sponsorId, name: draft.value.sponsorName ?? '' }]
    : []
  return [{ id: null as number | null, name: t('projects.charter.none') }, ...current, ...list]
})
function onSponsorSelect(userId: number | null) {
  selectSponsor(userId, sponsorItems.value.find(item => item.id === userId)?.name ?? null)
}

type TypeMenuItem = { id: number | null; name: string; charter_steps?: readonly string[] }
const typeMenuItems = computed<TypeMenuItem[]>(() => {
  const current = draft.value.typeId != null && !typeItems.value.some(item => item.id === draft.value.typeId)
    ? [{ id: draft.value.typeId, name: draft.value.typeName ?? '', charter_steps: draft.value.typeSteps ?? undefined }]
    : []
  return [{ id: null, name: t('projects.charter.none') }, ...current, ...typeItems.value]
})
function onTypeSelect(id: number | null) {
  selectType(typeMenuItems.value.find(item => item.id === id))
}
// Which optional steps the chosen classification adds between basics and review.
const typeStepLabels = computed(() => charterStepsForType(draft.value.typeSteps)
  .filter(step => step !== 'basics' && step !== 'review')
  .map(step => t(`projects.charter.steps.${step}`)))

const unitMenuItems = computed(() => {
  const current = draft.value.owningUnitId != null && !unitItems.value.some(item => item.id === draft.value.owningUnitId)
    ? [{ id: draft.value.owningUnitId, name: draft.value.owningUnitName ?? '' }]
    : []
  return [{ id: null as number | null, name: t('projects.charter.none') }, ...current, ...unitItems.value]
})
function onUnitSelect(id: number | null) {
  selectUnit(id, unitMenuItems.value.find(item => item.id === id)?.name ?? null)
}

const startLabel = computed(() => formatCalendarDate(draft.value.dateStart, locale.value) || t('projects.settings.noDate'))
const endLabel = computed(() => formatCalendarDate(draft.value.dateEnd, locale.value) || t('projects.settings.noDate'))

function onBudgetState(value: unknown) {
  if (value !== 'unknown' && value !== 'estimate') return
  draft.value.budgetState = value
  if (value === 'unknown') draft.value.amountInput = ''
}

const descriptionLooksHtml = computed(() => /<\/?[a-z][\s\S]*>/i.test(draft.value.description))
const readonlyDescription = computed(() => (
  descriptionLooksHtml.value ? sanitizeHtml(draft.value.description) : draft.value.description
))
</script>

<template>
  <div class="grid gap-6">
    <div v-if="show('name')" class="grid gap-2" data-testid="charter-field-name">
      <div class="flex items-center gap-1">
        <label for="charter-name" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.name') }}<span class="text-error">*</span></label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.name'))" :text="t('projects.charter.help.name')" />
      </div>
      <UInput id="charter-name" v-model="draft.name" class="w-full" data-testid="project-create-name" required :readonly="readonly" :disabled="controlsDisabled" />
      <p v-if="fieldErrors?.name" role="alert" class="text-sm text-error">{{ fieldErrors.name }}</p>
    </div>

    <div v-if="show('code')" class="grid gap-2" data-testid="charter-field-code">
      <div class="flex items-center gap-1"><label for="charter-code" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.code') }}</label><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.code'))" :text="t('projects.charter.help.code')" /></div>
      <UInput id="charter-code" :model-value="draft.code ?? t('projects.charter.codePending')" class="w-full" readonly disabled dir="ltr" />
    </div>

    <div v-if="show('description')" class="grid gap-2" data-testid="charter-field-description">
      <div class="flex items-center gap-1">
        <label for="charter-description" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.description') }}</label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.description'))" :text="t('projects.charter.help.description')" />
      </div>
      <div v-if="readonly && descriptionLooksHtml" class="rounded-md border bg-elevated/30 p-3 text-sm" v-html="readonlyDescription" />
      <UTextarea v-else id="charter-description" v-model="draft.description" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="4" />
    </div>

    <div v-if="show('type') || show('owning_unit')" class="grid gap-4 md:grid-cols-2">
      <div v-if="show('type')" class="grid gap-2" data-testid="charter-field-type">
        <div class="flex items-center gap-1">
          <label id="charter-type-label" for="charter-type" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.type') }}</label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.type'))" :text="t('projects.charter.help.type')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ draft.typeName || t('projects.charter.none') }}</p>
        <USelectMenu
          v-else
          id="charter-type"
          v-model:open="typeOpen"
          v-model:search-term="typeQuery"
          :model-value="draft.typeId"
          :items="typeMenuItems"
          value-key="id"
          label-key="name"
          ignore-filter
          :loading="typesPending"
          class="w-full min-w-0"
          data-testid="project-create-type"
          :disabled="controlsDisabled"
          aria-labelledby="charter-type-label charter-type-value"
          :placeholder="t('projects.charter.none')"
          @update:model-value="onTypeSelect"
        >
          <template #default><span id="charter-type-value" class="truncate">{{ draft.typeName || t('projects.charter.none') }}</span></template>
          <template v-if="typesHasMore" #content-bottom>
            <div class="border-t p-2">
              <UButton type="button" color="neutral" variant="ghost" size="sm" class="w-full" :disabled="typesPending" :label="t('app.loadMore')" @click="loadMoreTypes()" />
            </div>
          </template>
        </USelectMenu>
        <p v-if="!readonly" data-testid="charter-type-steps" class="text-xs text-muted">
          {{ typeStepLabels.length ? t('projects.charter.stepsForType', { steps: typeStepLabels.join(t('projects.charter.stepsJoin')) }) : t('projects.charter.stepsForTypeNone') }}
        </p>
        <p v-if="!readonly && !typeItems.length && !typesPending && canManageSettings" class="text-sm text-muted">
          <NuxtLink :to="catalogSettingsPath('types')" class="underline">{{ t('projects.charter.emptyTypesLink') }}</NuxtLink>
        </p>
        <p v-else-if="!readonly && !typeItems.length && !typesPending" class="text-sm text-muted">
          {{ t('projects.charter.emptyTypes') }}
        </p>
      </div>

      <div v-if="show('owning_unit')" class="grid gap-2" data-testid="charter-field-owning_unit">
        <div class="flex items-center gap-1">
          <label id="charter-owning-unit-label" for="charter-owning-unit" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.owning_unit') }}</label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.owning_unit'))" :text="t('projects.charter.help.owning_unit')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ draft.owningUnitName || t('projects.charter.none') }}</p>
        <USelectMenu
          v-else
          id="charter-owning-unit"
          v-model:open="unitOpen"
          v-model:search-term="unitQuery"
          :model-value="draft.owningUnitId"
          :items="unitMenuItems"
          value-key="id"
          label-key="name"
          ignore-filter
          :loading="unitsPending"
          class="w-full min-w-0"
          :disabled="controlsDisabled"
          aria-labelledby="charter-owning-unit-label charter-owning-unit-value"
          :placeholder="t('projects.charter.none')"
          @update:model-value="onUnitSelect"
        >
          <template #default><span id="charter-owning-unit-value" class="truncate">{{ draft.owningUnitName || t('projects.charter.none') }}</span></template>
          <template v-if="unitsHasMore" #content-bottom>
            <div class="border-t p-2">
              <UButton type="button" color="neutral" variant="ghost" size="sm" class="w-full" :disabled="unitsPending" :label="t('app.loadMore')" @click="loadMoreUnits()" />
            </div>
          </template>
        </USelectMenu>
        <p v-if="!readonly && !unitItems.length && !unitsPending && canManageSettings" class="text-sm text-muted">
          <NuxtLink :to="catalogSettingsPath('owning-units')" class="underline">{{ t('projects.charter.emptyUnitsLink') }}</NuxtLink>
        </p>
        <p v-else-if="!readonly && !unitItems.length && !unitsPending" class="text-sm text-muted">
          {{ t('projects.charter.emptyUnits') }}
        </p>
      </div>
    </div>

    <div v-if="show('manager') || show('sponsor')" class="grid gap-4 md:grid-cols-2">
      <div v-if="show('manager')" class="grid gap-2" data-testid="charter-field-manager">
        <div class="flex items-center gap-1">
          <label id="charter-manager-label" for="charter-manager" class="flex items-center gap-2 text-sm font-medium leading-none">
            {{ t('projects.charter.fields.manager') }}
            <span v-if="requireManager" class="text-error">*</span>
          </label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.manager'))" :text="t('projects.charter.help.manager')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ draft.managerName || t('projects.settings.noManager') }}</p>
        <USelectMenu
          v-else
          id="charter-manager"
          v-model:open="managerOpen"
          v-model:search-term="managerQ"
          :model-value="draft.userId"
          :items="managerItems"
          value-key="id"
          label-key="name"
          ignore-filter
          class="w-full min-w-0"
          data-testid="project-create-manager"
          :disabled="controlsDisabled"
          :aria-required="requireManager"
          aria-labelledby="charter-manager-label charter-manager-value"
          :placeholder="t('projects.settings.noManager')"
          @update:model-value="onManagerSelect"
        >
          <template #default><span id="charter-manager-value" class="truncate">{{ draft.managerName || t('projects.settings.noManager') }}</span></template>
        </USelectMenu>
        <p v-if="fieldErrors?.manager" role="alert" class="text-sm text-error">{{ fieldErrors.manager }}</p>
      </div>

      <div v-if="show('sponsor')" class="grid gap-2" data-testid="charter-field-sponsor">
        <div class="flex items-center gap-1">
          <label id="charter-sponsor-label" for="charter-sponsor" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.sponsor') }}</label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.sponsor'))" :text="t('projects.charter.help.sponsor')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ draft.sponsorName || t('projects.charter.none') }}</p>
        <USelectMenu
          v-else
          id="charter-sponsor"
          v-model:open="sponsorOpen"
          v-model:search-term="sponsorQ"
          :model-value="draft.sponsorId"
          :items="sponsorItems"
          value-key="id"
          label-key="name"
          ignore-filter
          class="w-full min-w-0"
          :disabled="controlsDisabled"
          aria-labelledby="charter-sponsor-label charter-sponsor-value"
          :placeholder="t('projects.charter.none')"
          @update:model-value="onSponsorSelect"
        >
          <template #default><span id="charter-sponsor-value" class="truncate">{{ draft.sponsorName || t('projects.charter.none') }}</span></template>
        </USelectMenu>
      </div>
    </div>

    <div v-if="show('authority')" class="grid gap-2" data-testid="charter-field-authority">
      <div class="flex items-center gap-1">
        <label for="charter-authority" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.authority') }}</label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.authority'))" :text="t('projects.charter.help.authority')" />
      </div>
      <UTextarea id="charter-authority" v-model="draft.authority" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </div>

    <div v-if="show('rationale')" class="grid gap-2" data-testid="charter-field-rationale">
      <div class="flex items-center gap-1">
        <label for="charter-rationale" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.rationale') }}</label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.rationale'))" :text="t('projects.charter.help.rationale')" />
      </div>
      <UTextarea id="charter-rationale" v-model="draft.rationale" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </div>

    <ProjectCharterRows
      v-if="show('objectives') || show('deliverables')"
      v-model="draft"
      :readonly="readonly"
      :disabled="controlsDisabled"
      :show-objectives="show('objectives')"
      :show-deliverables="show('deliverables')"
    />

    <div v-if="show('benefits')" class="grid gap-2" data-testid="charter-field-benefits">
      <div class="flex items-center gap-1">
        <label for="charter-benefits" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.benefits') }}</label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.benefits'))" :text="t('projects.charter.help.benefits')" />
      </div>
      <UTextarea id="charter-benefits" v-model="draft.benefits" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </div>

    <div v-if="show('scope')" class="grid gap-2" data-testid="charter-field-scope">
      <div class="flex items-center gap-1">
        <label for="charter-scope" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.scope') }}</label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.scope'))" :text="t('projects.charter.help.scope')" />
      </div>
      <UTextarea id="charter-scope" v-model="draft.scope" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </div>

    <div v-if="show('exclusions')" class="grid gap-2" data-testid="charter-field-exclusions">
      <div class="flex items-center gap-1">
        <label for="charter-exclusions" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.exclusions') }}</label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.exclusions'))" :text="t('projects.charter.help.exclusions')" />
      </div>
      <UTextarea id="charter-exclusions" v-model="draft.exclusions" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </div>

    <div v-if="show('high_level_requirements')" class="grid gap-2" data-testid="charter-field-high_level_requirements">
      <div class="flex items-center gap-1">
        <label for="charter-requirements" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.high_level_requirements') }}</label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.high_level_requirements'))" :text="t('projects.charter.help.high_level_requirements')" />
      </div>
      <UTextarea id="charter-requirements" v-model="draft.highLevelRequirements" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </div>

    <div v-if="show('success')" class="grid gap-2" data-testid="charter-field-success">
      <div class="flex items-center gap-1">
        <label for="charter-success" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.success') }}</label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.success'))" :text="t('projects.charter.help.success')" />
      </div>
      <UTextarea id="charter-success" v-model="draft.success" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </div>

    <div v-if="show('date_start') || show('date_end')" class="grid gap-4 md:grid-cols-2">
      <div v-if="show('date_start')" class="grid gap-2" data-testid="charter-field-date_start">
        <div class="flex items-center gap-1">
          <label id="charter-date-start-label" for="charter-date-start" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.date_start') }}</label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.date_start'))" :text="t('projects.charter.help.date_start')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ startLabel }}</p>
        <SharedDateField
          v-else
          id="charter-date-start"
          v-model="draft.dateStart"
          :disabled="controlsDisabled"
          :aria-label="t('projects.charter.fields.date_start')"
        />
        <p v-if="fieldErrors?.date_start" role="alert" class="text-sm text-error">{{ fieldErrors.date_start }}</p>
      </div>
      <div v-if="show('date_end')" class="grid gap-2" data-testid="charter-field-date_end">
        <div class="flex items-center gap-1"><label id="charter-date-end-label" for="charter-date-end" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.date_end') }}<span v-if="requireEndDate" class="text-error">*</span></label><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.date_end'))" :text="t('projects.charter.help.date_end')" /></div>
        <p v-if="readonly" class="text-sm">{{ endLabel }}</p>
        <SharedDateField
          v-else
          id="charter-date-end"
          v-model="draft.dateEnd"
          data-testid="project-create-end-date"
          :aria-required="requireEndDate"
          :disabled="controlsDisabled"
          :aria-label="t('projects.charter.fields.date_end')"
        />
        <p v-if="fieldErrors?.date_end" role="alert" class="text-sm text-error">{{ fieldErrors.date_end }}</p>
      </div>
    </div>

    <div v-if="show('priority')" class="grid gap-2" data-testid="charter-field-priority">
      <div class="flex items-center gap-1">
        <label id="charter-priority-label" for="charter-priority" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.priority') }}</label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.priority'))" :text="t('projects.charter.help.priority')" />
      </div>
      <p v-if="readonly" class="text-sm">{{ draft.priority ? t(`projects.charter.priority.${draft.priority}`) : t('projects.charter.none') }}</p>
      <USelect
        v-else
        id="charter-priority"
        :model-value="draft.priority ?? 'none'"
        :items="[{ value: 'none', label: t('projects.charter.none') }, ...PROJECT_PRIORITIES.map(priority => ({ value: priority, label: t(`projects.charter.priority.${priority}`) }))]"
        :disabled="controlsDisabled"
        class="w-full"
        aria-labelledby="charter-priority-label"
        @update:model-value="value => draft.priority = value === 'none' ? null : (value as typeof PROJECT_PRIORITIES[number])"
      />
    </div>

    <div v-if="show('budget_state') || show('amount') || show('currency')" class="grid gap-4 md:grid-cols-3">
      <div v-if="show('budget_state')" class="grid gap-2" data-testid="charter-field-budget_state">
        <div class="flex items-center gap-1">
          <label id="charter-budget-state-label" for="charter-budget-state" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.budget_state') }}</label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.budget_state'))" :text="t('projects.charter.help.budget_state')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ t(`projects.charter.budget.${draft.budgetState}`) }}</p>
        <USelect
          v-else
          id="charter-budget-state"
          :model-value="draft.budgetState"
          :items="[{ value: 'unknown', label: t('projects.charter.budget.unknown') }, { value: 'estimate', label: t('projects.charter.budget.estimate') }]"
          :disabled="controlsDisabled"
          class="w-full"
          aria-labelledby="charter-budget-state-label"
          @update:model-value="onBudgetState"
        />
      </div>
      <div v-if="show('amount')" class="grid gap-2" data-testid="charter-field-amount">
        <div class="flex items-center gap-1">
          <label for="charter-amount" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.amount') }}</label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.amount'))" :text="t('projects.charter.help.amount')" />
        </div>
        <UInput
          id="charter-amount"
          v-model="draft.amountInput"
          class="w-full"
          inputmode="decimal"
          dir="ltr"
          :readonly="readonly || draft.budgetState === 'unknown'"
          :disabled="controlsDisabled || draft.budgetState === 'unknown'"
        />
        <p v-if="fieldErrors?.amount" role="alert" class="text-sm text-error">{{ fieldErrors.amount }}</p>
      </div>
      <div v-if="show('currency')" class="grid gap-2" data-testid="charter-field-currency">
        <div class="flex items-center gap-1">
          <label for="charter-currency" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.currency') }}</label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.currency'))" :text="t('projects.charter.help.currency')" />
        </div>
        <UInput id="charter-currency" :model-value="draft.currencyLabel || t('projects.charter.none')" class="w-full" readonly disabled />
      </div>
    </div>

    <div v-if="show('assumptions')" class="grid gap-2" data-testid="charter-field-assumptions">
      <div class="flex items-center gap-1">
        <label for="charter-assumptions" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.assumptions') }}</label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.assumptions'))" :text="t('projects.charter.help.assumptions')" />
      </div>
      <UTextarea id="charter-assumptions" v-model="draft.assumptions" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </div>

    <div v-if="show('constraints')" class="grid gap-2" data-testid="charter-field-constraints">
      <div class="flex items-center gap-1">
        <label for="charter-constraints" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.constraints') }}</label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.constraints'))" :text="t('projects.charter.help.constraints')" />
      </div>
      <UTextarea id="charter-constraints" v-model="draft.constraints" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </div>

    <div v-if="show('closure')" class="grid gap-2" data-testid="charter-field-closure">
      <div class="flex items-center gap-1">
        <label for="charter-closure" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.closure') }}</label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.closure'))" :text="t('projects.charter.help.closure')" />
      </div>
      <UTextarea id="charter-closure" v-model="draft.closure" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </div>
  </div>
</template>
