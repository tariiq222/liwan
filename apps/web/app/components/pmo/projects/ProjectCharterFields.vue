<script setup lang="ts">
import type { ProjectCharterCatalogResource } from '@webvue/contracts'
import { formatCalendarDate } from '@webvue/ui/app/composables/calendarDate'
import { useCharterCatalogSearch } from '@/composables/useProjectCharterCatalogs'
import type { CharterDraft, CharterFieldKey } from '@/utils/projectCharter'
import { CHARTER_FIELD_KEYS, PROJECT_PRIORITIES } from '@/utils/projectCharter'
import { charterStepsForType } from '@/utils/charterSteps'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import ProjectCharterRows from '@/components/pmo/projects/ProjectCharterRows.vue'
import ProjectFieldHelp from '@/components/pmo/projects/ProjectFieldHelp.vue'

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
  return { path: `/settings/apps/projects/catalogs/${resource}`, query: returnToQuery(route.fullPath) }
}

// The charter manager and sponsor are res.users ids from /api/v1/people.
function onManagerResolve(people: { id: number; name: string }[]) {
  draft.value.userId = people[0]?.id ?? null
  draft.value.managerName = people[0]?.name ?? null
}

function onSponsorResolve(people: { id: number; name: string }[]) {
  draft.value.sponsorId = people[0]?.id ?? null
  draft.value.sponsorName = people[0]?.name ?? null
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
// currently chosen catalog value may fall outside the active search results,
// so it is always merged in to keep the trigger label correct.
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
</script>

<template>
  <div class="grid gap-(--webvue-card-pad)">
    <div v-if="show('name') || show('code')" class="grid gap-(--webvue-gap-card) sm:grid-cols-3">
    <UFormField v-if="show('name')" class="sm:col-span-2" :label="t('projects.charter.fields.name')" required :error="fieldErrors?.name" data-testid="charter-field-name">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.name'))" :text="t('projects.charter.help.name')" /></template>
      <template #error="{ error }"><span role="alert">{{ error }}</span></template>
      <UInput id="charter-name" v-model="draft.name" class="w-full" data-testid="project-create-name" required :readonly="readonly" :disabled="controlsDisabled" />
    </UFormField>

    <UFormField v-if="show('code')" :label="t('projects.charter.fields.code')" data-testid="charter-field-code">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.code'))" :text="t('projects.charter.help.code')" /></template>
      <UInput id="charter-code" :model-value="draft.code ?? t('projects.charter.codePending')" class="w-full" readonly disabled dir="ltr" />
    </UFormField>

    </div>

    <UFormField v-if="show('description')" :label="t('projects.charter.fields.description')" data-testid="charter-field-description">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.description'))" :text="t('projects.charter.help.description')" /></template>
      <SharedSubCard v-if="readonly && descriptionLooksHtml" tone="tinted">
        <SharedRichText size="sm" :html="draft.description" />
      </SharedSubCard>
      <UTextarea v-else id="charter-description" v-model="draft.description" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </UFormField>

    <div v-if="show('type') || show('owning_unit')" class="grid gap-(--webvue-gap-card) md:grid-cols-2">
      <UFormField v-if="show('type')" data-testid="charter-field-type">
        <template #label><span id="charter-type-label">{{ t('projects.charter.fields.type') }}</span></template>
        <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.type'))" :text="t('projects.charter.help.type')" /></template>
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
            <div class="border-t border-default p-2">
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
      </UFormField>

      <UFormField v-if="show('owning_unit')" data-testid="charter-field-owning_unit">
        <template #label><span id="charter-owning-unit-label">{{ t('projects.charter.fields.owning_unit') }}</span></template>
        <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.owning_unit'))" :text="t('projects.charter.help.owning_unit')" /></template>
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
            <div class="border-t border-default p-2">
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
      </UFormField>
    </div>

    <div v-if="show('manager') || show('sponsor')" class="grid gap-(--webvue-gap-card) md:grid-cols-2">
      <UFormField v-if="show('manager')" :required="requireManager" :error="fieldErrors?.manager" data-testid="charter-field-manager">
        <template #label><span id="charter-manager-label">{{ t('projects.charter.fields.manager') }}</span></template>
        <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.manager'))" :text="t('projects.charter.help.manager')" /></template>
        <template #error="{ error }"><span role="alert">{{ error }}</span></template>
        <p v-if="readonly" class="text-sm">{{ draft.managerName || t('projects.settings.noManager') }}</p>
        <div v-else class="flex min-w-0 items-center gap-1">
          <SharedPersonPicker
            id="charter-manager"
            :model-value="draft.userId"
            value-key="user_id"
            :known="draft.userId != null ? [{ id: draft.userId, name: draft.managerName ?? '' }] : []"
            :placeholder="t('projects.settings.noManager')"
            :disabled="controlsDisabled"
            aria-labelledby="charter-manager-label charter-manager"
            :aria-required="requireManager"
            data-testid="project-create-manager"
            @resolve="onManagerResolve"
          />
          <UButton
            v-if="!requireManager && draft.userId != null"
            type="button"
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-x"
            :disabled="controlsDisabled"
            :aria-label="t('projects.charter.clearField', { field: t('projects.charter.fields.manager') })"
            @click="onManagerResolve([])"
          />
        </div>
      </UFormField>

      <UFormField v-if="show('sponsor')" data-testid="charter-field-sponsor">
        <template #label><span id="charter-sponsor-label">{{ t('projects.charter.fields.sponsor') }}</span></template>
        <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.sponsor'))" :text="t('projects.charter.help.sponsor')" /></template>
        <p v-if="readonly" class="text-sm">{{ draft.sponsorName || t('projects.charter.none') }}</p>
        <div v-else class="flex min-w-0 items-center gap-1">
          <SharedPersonPicker
            id="charter-sponsor"
            :model-value="draft.sponsorId"
            value-key="user_id"
            :known="draft.sponsorId != null ? [{ id: draft.sponsorId, name: draft.sponsorName ?? '' }] : []"
            :placeholder="t('projects.charter.none')"
            :disabled="controlsDisabled"
            aria-labelledby="charter-sponsor-label charter-sponsor"
            @resolve="onSponsorResolve"
          />
          <UButton
            v-if="draft.sponsorId != null"
            type="button"
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-x"
            :disabled="controlsDisabled"
            :aria-label="t('projects.charter.clearField', { field: t('projects.charter.fields.sponsor') })"
            @click="onSponsorResolve([])"
          />
        </div>
      </UFormField>
    </div>

    <UFormField v-if="show('authority')" :label="t('projects.charter.fields.authority')" data-testid="charter-field-authority">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.authority'))" :text="t('projects.charter.help.authority')" /></template>
      <UTextarea id="charter-authority" v-model="draft.authority" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </UFormField>

    <UFormField v-if="show('rationale')" :label="t('projects.charter.fields.rationale')" data-testid="charter-field-rationale">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.rationale'))" :text="t('projects.charter.help.rationale')" /></template>
      <UTextarea id="charter-rationale" v-model="draft.rationale" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </UFormField>

    <ProjectCharterRows
      v-if="show('objectives') || show('deliverables')"
      v-model="draft"
      :readonly="readonly"
      :disabled="controlsDisabled"
      :show-objectives="show('objectives')"
      :show-deliverables="show('deliverables')"
    />

    <UFormField v-if="show('benefits')" :label="t('projects.charter.fields.benefits')" data-testid="charter-field-benefits">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.benefits'))" :text="t('projects.charter.help.benefits')" /></template>
      <UTextarea id="charter-benefits" v-model="draft.benefits" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </UFormField>

    <UFormField v-if="show('scope')" :label="t('projects.charter.fields.scope')" data-testid="charter-field-scope">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.scope'))" :text="t('projects.charter.help.scope')" /></template>
      <UTextarea id="charter-scope" v-model="draft.scope" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </UFormField>

    <UFormField v-if="show('exclusions')" :label="t('projects.charter.fields.exclusions')" data-testid="charter-field-exclusions">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.exclusions'))" :text="t('projects.charter.help.exclusions')" /></template>
      <UTextarea id="charter-exclusions" v-model="draft.exclusions" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </UFormField>

    <UFormField v-if="show('high_level_requirements')" :label="t('projects.charter.fields.high_level_requirements')" data-testid="charter-field-high_level_requirements">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.high_level_requirements'))" :text="t('projects.charter.help.high_level_requirements')" /></template>
      <UTextarea id="charter-requirements" v-model="draft.highLevelRequirements" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </UFormField>

    <UFormField v-if="show('success')" :label="t('projects.charter.fields.success')" data-testid="charter-field-success">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.success'))" :text="t('projects.charter.help.success')" /></template>
      <UTextarea id="charter-success" v-model="draft.success" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </UFormField>

    <div v-if="show('date_start') || show('date_end')" class="grid gap-(--webvue-gap-card) md:grid-cols-2">
      <UFormField v-if="show('date_start')" :label="t('projects.charter.fields.date_start')" :error="fieldErrors?.date_start" data-testid="charter-field-date_start">
        <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.date_start'))" :text="t('projects.charter.help.date_start')" /></template>
        <template #error="{ error }"><span role="alert">{{ error }}</span></template>
        <p v-if="readonly" class="text-sm">{{ startLabel }}</p>
        <SharedDateField
          v-else
          id="charter-date-start"
          v-model="draft.dateStart"
          :disabled="controlsDisabled"
          :aria-label="t('projects.charter.fields.date_start')"
        />
      </UFormField>
      <UFormField v-if="show('date_end')" :label="t('projects.charter.fields.date_end')" :required="requireEndDate" :error="fieldErrors?.date_end" data-testid="charter-field-date_end">
        <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.date_end'))" :text="t('projects.charter.help.date_end')" /></template>
        <template #error="{ error }"><span role="alert">{{ error }}</span></template>
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
      </UFormField>
    </div>

    <UFormField v-if="show('priority')" data-testid="charter-field-priority">
      <template #label><span id="charter-priority-label">{{ t('projects.charter.fields.priority') }}</span></template>
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.priority'))" :text="t('projects.charter.help.priority')" /></template>
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
    </UFormField>

    <div v-if="show('budget_state') || show('amount') || show('currency')" class="grid gap-(--webvue-gap-card) md:grid-cols-3">
      <UFormField v-if="show('budget_state')" data-testid="charter-field-budget_state">
        <template #label><span id="charter-budget-state-label">{{ t('projects.charter.fields.budget_state') }}</span></template>
        <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.budget_state'))" :text="t('projects.charter.help.budget_state')" /></template>
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
      </UFormField>
      <UFormField v-if="show('amount')" :label="t('projects.charter.fields.amount')" :error="fieldErrors?.amount" data-testid="charter-field-amount">
        <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.amount'))" :text="t('projects.charter.help.amount')" /></template>
        <template #error="{ error }"><span role="alert">{{ error }}</span></template>
        <UInput
          id="charter-amount"
          v-model="draft.amountInput"
          class="w-full"
          inputmode="decimal"
          dir="ltr"
          :readonly="readonly || draft.budgetState === 'unknown'"
          :disabled="controlsDisabled || draft.budgetState === 'unknown'"
        />
      </UFormField>
      <UFormField v-if="show('currency')" :label="t('projects.charter.fields.currency')" data-testid="charter-field-currency">
        <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.currency'))" :text="t('projects.charter.help.currency')" /></template>
        <UInput id="charter-currency" :model-value="draft.currencyLabel || t('projects.charter.none')" class="w-full" readonly disabled />
      </UFormField>
    </div>

    <UFormField v-if="show('assumptions')" :label="t('projects.charter.fields.assumptions')" data-testid="charter-field-assumptions">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.assumptions'))" :text="t('projects.charter.help.assumptions')" /></template>
      <UTextarea id="charter-assumptions" v-model="draft.assumptions" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </UFormField>

    <UFormField v-if="show('constraints')" :label="t('projects.charter.fields.constraints')" data-testid="charter-field-constraints">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.constraints'))" :text="t('projects.charter.help.constraints')" /></template>
      <UTextarea id="charter-constraints" v-model="draft.constraints" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </UFormField>

    <UFormField v-if="show('closure')" :label="t('projects.charter.fields.closure')" data-testid="charter-field-closure">
      <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.closure'))" :text="t('projects.charter.help.closure')" /></template>
      <UTextarea id="charter-closure" v-model="draft.closure" class="w-full" :readonly="readonly" :disabled="controlsDisabled" :rows="3" />
    </UFormField>
  </div>
</template>
