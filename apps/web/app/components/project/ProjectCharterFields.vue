<script setup lang="ts">
import type { CalendarDate } from '@internationalized/date'
import type { ProjectCharterCatalogResource } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import { Check } from '@lucide/vue'
import { formatCalendarDate, fromCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { usePeople } from '@/composables/usePeople'
import { useCharterCatalogSearch } from '@/composables/useProjectCharterCatalogs'
import type { CharterDraft, CharterFieldKey } from '@/utils/projectCharter'
import { PROJECT_PRIORITIES } from '@/utils/projectCharter'
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
}>()

const { t, locale } = useI18n()
const { can } = useAccess()
const route = useRoute()
const hydrated = useHydrated()
const canManageSettings = computed(() => can('pmo.settings.manage'))
const controlsDisabled = computed(() => props.disabled || !hydrated.value)

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
} = useCharterCatalogSearch('types', computed(() => !props.readonly))
const {
  q: unitQuery,
  items: unitItems,
  pending: unitsPending,
  hasMore: unitsHasMore,
  loadMore: loadMoreUnits,
} = useCharterCatalogSearch('owning-units', computed(() => !props.readonly))

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

function selectType(id: number | null, name: string | null) {
  typeOpen.value = false
  typeQuery.value = ''
  draft.value.typeId = id
  draft.value.typeName = name
}

function selectUnit(id: number | null, name: string | null) {
  unitOpen.value = false
  unitQuery.value = ''
  draft.value.owningUnitId = id
  draft.value.owningUnitName = name
}

const startValue = computed(() => toCalendarDate(draft.value.dateStart))
const endValue = computed(() => toCalendarDate(draft.value.dateEnd))
const startLabel = computed(() => formatCalendarDate(draft.value.dateStart, locale.value) || t('projects.settings.noDate'))
const endLabel = computed(() => formatCalendarDate(draft.value.dateEnd, locale.value) || t('projects.settings.noDate'))

function onStartChange(value: unknown) {
  draft.value.dateStart = fromCalendarDate(value as CalendarDate | undefined)
}

function onEndChange(value: unknown) {
  draft.value.dateEnd = fromCalendarDate(value as CalendarDate | undefined)
}

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
    <div class="grid gap-2" data-testid="charter-field-name">
      <div class="flex items-center gap-1">
        <Label for="charter-name">{{ t('projects.charter.fields.name') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.name'))" :text="t('projects.charter.help.name')" />
      </div>
      <Input id="charter-name" v-model="draft.name" data-testid="project-create-name" required :readonly="readonly" :disabled="controlsDisabled" />
      <p v-if="fieldErrors?.name" role="alert" class="text-sm text-destructive">{{ fieldErrors.name }}</p>
    </div>

    <div class="grid gap-2" data-testid="charter-field-code">
      <div class="flex items-center gap-1">
        <Label for="charter-code">{{ t('projects.charter.fields.code') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.code'))" :text="t('projects.charter.help.code')" />
      </div>
      <Input id="charter-code" :model-value="draft.code ?? t('projects.charter.codePending')" readonly disabled dir="ltr" />
    </div>

    <div class="grid gap-2" data-testid="charter-field-description">
      <div class="flex items-center gap-1">
        <Label for="charter-description">{{ t('projects.charter.fields.description') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.description'))" :text="t('projects.charter.help.description')" />
      </div>
      <div v-if="readonly && descriptionLooksHtml" class="rounded-md border bg-muted/30 p-3 text-sm" v-html="readonlyDescription" />
      <Textarea v-else id="charter-description" v-model="draft.description" :readonly="readonly" :disabled="controlsDisabled" rows="4" />
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <div class="grid gap-2" data-testid="charter-field-type">
        <div class="flex items-center gap-1">
          <Label id="charter-type-label" for="charter-type">{{ t('projects.charter.fields.type') }}</Label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.type'))" :text="t('projects.charter.help.type')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ draft.typeName || t('projects.charter.none') }}</p>
        <Popover v-else v-model:open="typeOpen">
          <PopoverTrigger as-child>
            <Button id="charter-type" variant="outline" class="w-full min-w-0 justify-start" type="button" :disabled="controlsDisabled" aria-labelledby="charter-type-label charter-type-value">
              <span id="charter-type-value" class="min-w-0 truncate" :title="draft.typeName || t('projects.charter.none')">{{ draft.typeName || t('projects.charter.none') }}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-64 p-0" align="start">
            <div class="border-b p-2">
              <Input v-model="typeQuery" :placeholder="t('app.search')" class="h-8" />
            </div>
            <Command>
              <CommandList>
                <CommandEmpty>{{ t('app.noResults') }}</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="none" @select="selectType(null, null)">
                    <span class="flex-1">{{ t('projects.charter.none') }}</span>
                    <Check v-if="!draft.typeId" class="size-4" />
                  </CommandItem>
                  <CommandItem v-for="item in typeItems" :key="item.id" :value="String(item.id)" @select="selectType(item.id, item.name)">
                    <span class="flex-1">{{ item.name }}</span>
                    <Check v-if="draft.typeId === item.id" class="size-4" />
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
            <div v-if="typesHasMore" class="border-t p-2">
              <Button type="button" variant="ghost" size="sm" class="w-full" :disabled="typesPending" @click="loadMoreTypes()">
                {{ t('app.loadMore') }}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <p v-if="!readonly && !typeItems.length && !typesPending && canManageSettings" class="text-sm text-muted-foreground">
          <NuxtLink :to="catalogSettingsPath('types')" class="underline">{{ t('projects.charter.emptyTypesLink') }}</NuxtLink>
        </p>
        <p v-else-if="!readonly && !typeItems.length && !typesPending" class="text-sm text-muted-foreground">
          {{ t('projects.charter.emptyTypes') }}
        </p>
      </div>

      <div class="grid gap-2" data-testid="charter-field-owning_unit">
        <div class="flex items-center gap-1">
          <Label id="charter-owning-unit-label" for="charter-owning-unit">{{ t('projects.charter.fields.owning_unit') }}</Label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.owning_unit'))" :text="t('projects.charter.help.owning_unit')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ draft.owningUnitName || t('projects.charter.none') }}</p>
        <Popover v-else v-model:open="unitOpen">
          <PopoverTrigger as-child>
            <Button id="charter-owning-unit" variant="outline" class="w-full min-w-0 justify-start" type="button" :disabled="controlsDisabled" aria-labelledby="charter-owning-unit-label charter-owning-unit-value">
              <span id="charter-owning-unit-value" class="min-w-0 truncate" :title="draft.owningUnitName || t('projects.charter.none')">{{ draft.owningUnitName || t('projects.charter.none') }}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-64 p-0" align="start">
            <div class="border-b p-2">
              <Input v-model="unitQuery" :placeholder="t('app.search')" class="h-8" />
            </div>
            <Command>
              <CommandList>
                <CommandEmpty>{{ t('app.noResults') }}</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="none" @select="selectUnit(null, null)">
                    <span class="flex-1">{{ t('projects.charter.none') }}</span>
                    <Check v-if="!draft.owningUnitId" class="size-4" />
                  </CommandItem>
                  <CommandItem v-for="item in unitItems" :key="item.id" :value="String(item.id)" @select="selectUnit(item.id, item.name)">
                    <span class="flex-1">{{ item.name }}</span>
                    <Check v-if="draft.owningUnitId === item.id" class="size-4" />
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
            <div v-if="unitsHasMore" class="border-t p-2">
              <Button type="button" variant="ghost" size="sm" class="w-full" :disabled="unitsPending" @click="loadMoreUnits()">
                {{ t('app.loadMore') }}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <p v-if="!readonly && !unitItems.length && !unitsPending && canManageSettings" class="text-sm text-muted-foreground">
          <NuxtLink :to="catalogSettingsPath('owning-units')" class="underline">{{ t('projects.charter.emptyUnitsLink') }}</NuxtLink>
        </p>
        <p v-else-if="!readonly && !unitItems.length && !unitsPending" class="text-sm text-muted-foreground">
          {{ t('projects.charter.emptyUnits') }}
        </p>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <div class="grid gap-2" data-testid="charter-field-sponsor">
        <div class="flex items-center gap-1">
          <Label id="charter-sponsor-label" for="charter-sponsor">{{ t('projects.charter.fields.sponsor') }}</Label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.sponsor'))" :text="t('projects.charter.help.sponsor')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ draft.sponsorName || t('projects.charter.none') }}</p>
        <Popover v-else v-model:open="sponsorOpen">
          <PopoverTrigger as-child>
            <Button id="charter-sponsor" variant="outline" class="w-full min-w-0 justify-start" type="button" :disabled="controlsDisabled" aria-labelledby="charter-sponsor-label charter-sponsor-value">
              <span id="charter-sponsor-value" class="min-w-0 truncate" :title="draft.sponsorName || t('projects.charter.none')">{{ draft.sponsorName || t('projects.charter.none') }}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-64 p-0" align="start">
            <div class="border-b p-2">
              <Input v-model="sponsorQ" :placeholder="t('app.search')" class="h-8" />
            </div>
            <Command>
              <CommandList>
                <CommandEmpty>{{ t('app.noResults') }}</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="none" @select="selectSponsor(null, null)">
                    <span class="flex-1">{{ t('projects.charter.none') }}</span>
                    <Check v-if="!draft.sponsorId" class="size-4" />
                  </CommandItem>
                  <CommandItem v-for="person in sponsors ?? []" :key="person.id" :value="String(person.id)" @select="selectSponsor(person.id, person.name)">
                    <span class="flex-1">{{ person.name }}</span>
                    <Check v-if="draft.sponsorId === person.id" class="size-4" />
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div class="grid gap-2" data-testid="charter-field-manager">
        <div class="flex items-center gap-1">
          <Label id="charter-manager-label" for="charter-manager">
            {{ t('projects.charter.fields.manager') }}
            <span v-if="requireManager" class="text-destructive">*</span>
          </Label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.manager'))" :text="t('projects.charter.help.manager')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ draft.managerName || t('projects.settings.noManager') }}</p>
        <Popover v-else v-model:open="managerOpen">
          <PopoverTrigger as-child>
            <Button
              variant="outline"
              id="charter-manager"
              class="w-full min-w-0 justify-start"
              type="button"
              data-testid="project-create-manager"
              :disabled="controlsDisabled"
              :aria-required="requireManager"
              aria-labelledby="charter-manager-label charter-manager-value"
            >
              <span id="charter-manager-value" class="min-w-0 truncate" :title="draft.managerName || t('projects.settings.noManager')">{{ draft.managerName || t('projects.settings.noManager') }}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-64 p-0" align="start">
            <div class="border-b p-2">
              <Input v-model="managerQ" :placeholder="t('app.search')" class="h-8" />
            </div>
            <Command>
              <CommandList>
                <CommandEmpty>{{ t('app.noResults') }}</CommandEmpty>
                <CommandGroup>
                  <CommandItem v-if="!requireManager" value="none" @select="selectManager(null, null)">
                    <span class="flex-1">{{ t('projects.settings.noManager') }}</span>
                    <Check v-if="!draft.userId" class="size-4" />
                  </CommandItem>
                  <CommandItem v-for="person in managers ?? []" :key="person.id" :value="String(person.id)" @select="selectManager(person.id, person.name)">
                    <span class="flex-1">{{ person.name }}</span>
                    <Check v-if="draft.userId === person.id" class="size-4" />
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>

    <div class="grid gap-2" data-testid="charter-field-authority">
      <div class="flex items-center gap-1">
        <Label for="charter-authority">{{ t('projects.charter.fields.authority') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.authority'))" :text="t('projects.charter.help.authority')" />
      </div>
      <Textarea id="charter-authority" v-model="draft.authority" :readonly="readonly" :disabled="controlsDisabled" rows="3" />
    </div>

    <div class="grid gap-2" data-testid="charter-field-rationale">
      <div class="flex items-center gap-1">
        <Label for="charter-rationale">{{ t('projects.charter.fields.rationale') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.rationale'))" :text="t('projects.charter.help.rationale')" />
      </div>
      <Textarea id="charter-rationale" v-model="draft.rationale" :readonly="readonly" :disabled="controlsDisabled" rows="3" />
    </div>

    <ProjectCharterRows v-model="draft" :readonly="readonly" :disabled="controlsDisabled" />

    <div class="grid gap-2" data-testid="charter-field-benefits">
      <div class="flex items-center gap-1">
        <Label for="charter-benefits">{{ t('projects.charter.fields.benefits') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.benefits'))" :text="t('projects.charter.help.benefits')" />
      </div>
      <Textarea id="charter-benefits" v-model="draft.benefits" :readonly="readonly" :disabled="controlsDisabled" rows="3" />
    </div>

    <div class="grid gap-2" data-testid="charter-field-scope">
      <div class="flex items-center gap-1">
        <Label for="charter-scope">{{ t('projects.charter.fields.scope') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.scope'))" :text="t('projects.charter.help.scope')" />
      </div>
      <Textarea id="charter-scope" v-model="draft.scope" :readonly="readonly" :disabled="controlsDisabled" rows="3" />
    </div>

    <div class="grid gap-2" data-testid="charter-field-exclusions">
      <div class="flex items-center gap-1">
        <Label for="charter-exclusions">{{ t('projects.charter.fields.exclusions') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.exclusions'))" :text="t('projects.charter.help.exclusions')" />
      </div>
      <Textarea id="charter-exclusions" v-model="draft.exclusions" :readonly="readonly" :disabled="controlsDisabled" rows="3" />
    </div>

    <div class="grid gap-2" data-testid="charter-field-high_level_requirements">
      <div class="flex items-center gap-1">
        <Label for="charter-requirements">{{ t('projects.charter.fields.high_level_requirements') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.high_level_requirements'))" :text="t('projects.charter.help.high_level_requirements')" />
      </div>
      <Textarea id="charter-requirements" v-model="draft.highLevelRequirements" :readonly="readonly" :disabled="controlsDisabled" rows="3" />
    </div>

    <div class="grid gap-2" data-testid="charter-field-success">
      <div class="flex items-center gap-1">
        <Label for="charter-success">{{ t('projects.charter.fields.success') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.success'))" :text="t('projects.charter.help.success')" />
      </div>
      <Textarea id="charter-success" v-model="draft.success" :readonly="readonly" :disabled="controlsDisabled" rows="3" />
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <div class="grid gap-2" data-testid="charter-field-date_start">
        <div class="flex items-center gap-1">
          <Label id="charter-date-start-label" for="charter-date-start">{{ t('projects.charter.fields.date_start') }}</Label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.date_start'))" :text="t('projects.charter.help.date_start')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ startLabel }}</p>
        <Popover v-else>
          <PopoverTrigger as-child>
            <Button id="charter-date-start" variant="outline" class="justify-start" type="button" :disabled="controlsDisabled" aria-labelledby="charter-date-start-label charter-date-start-value">
              <span id="charter-date-start-value">{{ startLabel }}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-0" align="start">
            <Calendar :model-value="startValue" @update:model-value="onStartChange" />
            <div v-if="draft.dateStart" class="border-t p-2">
              <Button variant="ghost" size="sm" type="button" class="w-full" @click="draft.dateStart = null">{{ t('projects.settings.noDate') }}</Button>
            </div>
          </PopoverContent>
        </Popover>
        <p v-if="fieldErrors?.date_start" role="alert" class="text-sm text-destructive">{{ fieldErrors.date_start }}</p>
      </div>
      <div class="grid gap-2" data-testid="charter-field-date_end">
        <div class="flex items-center gap-1">
          <Label id="charter-date-end-label" for="charter-date-end">
            {{ t('projects.charter.fields.date_end') }}
            <span v-if="requireEndDate" class="text-destructive">*</span>
          </Label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.date_end'))" :text="t('projects.charter.help.date_end')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ endLabel }}</p>
        <Popover v-else>
          <PopoverTrigger as-child>
            <Button
              variant="outline"
              class="justify-start"
              type="button"
              id="charter-date-end"
              data-testid="project-create-end-date"
              :disabled="controlsDisabled"
              aria-labelledby="charter-date-end-label charter-date-end-value"
              :aria-required="requireEndDate"
            >
              <span id="charter-date-end-value">{{ endLabel }}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-0" align="start">
            <Calendar :model-value="endValue" @update:model-value="onEndChange" />
            <div v-if="draft.dateEnd" class="border-t p-2">
              <Button variant="ghost" size="sm" type="button" class="w-full" @click="draft.dateEnd = null">{{ t('projects.settings.noDate') }}</Button>
            </div>
          </PopoverContent>
        </Popover>
        <p v-if="fieldErrors?.date_end" role="alert" class="text-sm text-destructive">{{ fieldErrors.date_end }}</p>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-3">
      <div class="grid gap-2" data-testid="charter-field-budget_state">
        <div class="flex items-center gap-1">
          <Label id="charter-budget-state-label" for="charter-budget-state">{{ t('projects.charter.fields.budget_state') }}</Label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.budget_state'))" :text="t('projects.charter.help.budget_state')" />
        </div>
        <p v-if="readonly" class="text-sm">{{ t(`projects.charter.budget.${draft.budgetState}`) }}</p>
        <Select v-else :model-value="draft.budgetState" :disabled="controlsDisabled" @update:model-value="onBudgetState">
          <SelectTrigger id="charter-budget-state" class="w-full" aria-labelledby="charter-budget-state-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unknown">{{ t('projects.charter.budget.unknown') }}</SelectItem>
            <SelectItem value="estimate">{{ t('projects.charter.budget.estimate') }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="grid gap-2" data-testid="charter-field-amount">
        <div class="flex items-center gap-1">
          <Label for="charter-amount">{{ t('projects.charter.fields.amount') }}</Label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.amount'))" :text="t('projects.charter.help.amount')" />
        </div>
        <Input
          id="charter-amount"
          v-model="draft.amountInput"
          inputmode="decimal"
          dir="ltr"
          :readonly="readonly || draft.budgetState === 'unknown'"
          :disabled="controlsDisabled || draft.budgetState === 'unknown'"
        />
        <p v-if="fieldErrors?.amount" role="alert" class="text-sm text-destructive">{{ fieldErrors.amount }}</p>
      </div>
      <div class="grid gap-2" data-testid="charter-field-currency">
        <div class="flex items-center gap-1">
          <Label for="charter-currency">{{ t('projects.charter.fields.currency') }}</Label>
          <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.currency'))" :text="t('projects.charter.help.currency')" />
        </div>
        <Input id="charter-currency" :model-value="draft.currencyLabel || t('projects.charter.none')" readonly disabled />
      </div>
    </div>

    <div class="grid gap-2" data-testid="charter-field-priority">
      <div class="flex items-center gap-1">
        <Label id="charter-priority-label" for="charter-priority">{{ t('projects.charter.fields.priority') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.priority'))" :text="t('projects.charter.help.priority')" />
      </div>
      <p v-if="readonly" class="text-sm">{{ draft.priority ? t(`projects.charter.priority.${draft.priority}`) : t('projects.charter.none') }}</p>
      <Select v-else :model-value="draft.priority ?? 'none'" :disabled="controlsDisabled" @update:model-value="draft.priority = $event === 'none' ? null : ($event as typeof PROJECT_PRIORITIES[number])">
        <SelectTrigger id="charter-priority" class="w-full" aria-labelledby="charter-priority-label">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{{ t('projects.charter.none') }}</SelectItem>
          <SelectItem v-for="priority in PROJECT_PRIORITIES" :key="priority" :value="priority">
            {{ t(`projects.charter.priority.${priority}`) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="grid gap-2" data-testid="charter-field-assumptions">
      <div class="flex items-center gap-1">
        <Label for="charter-assumptions">{{ t('projects.charter.fields.assumptions') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.assumptions'))" :text="t('projects.charter.help.assumptions')" />
      </div>
      <Textarea id="charter-assumptions" v-model="draft.assumptions" :readonly="readonly" :disabled="controlsDisabled" rows="3" />
    </div>

    <div class="grid gap-2" data-testid="charter-field-constraints">
      <div class="flex items-center gap-1">
        <Label for="charter-constraints">{{ t('projects.charter.fields.constraints') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.constraints'))" :text="t('projects.charter.help.constraints')" />
      </div>
      <Textarea id="charter-constraints" v-model="draft.constraints" :readonly="readonly" :disabled="controlsDisabled" rows="3" />
    </div>

    <div class="grid gap-2" data-testid="charter-field-closure">
      <div class="flex items-center gap-1">
        <Label for="charter-closure">{{ t('projects.charter.fields.closure') }}</Label>
        <ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.closure'))" :text="t('projects.charter.help.closure')" />
      </div>
      <Textarea id="charter-closure" v-model="draft.closure" :readonly="readonly" :disabled="controlsDisabled" rows="3" />
    </div>
  </div>
</template>
