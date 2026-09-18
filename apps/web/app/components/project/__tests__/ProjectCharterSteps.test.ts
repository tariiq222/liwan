import type { ObjectiveDraft, DeliverableDraft } from '@/utils/projectCharter'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const fieldsFilename = resolve(here, '../ProjectCharterFields.vue')
const rowsFilename = resolve(here, '../ProjectCharterRows.vue')
const displayFilename = resolve(here, '../ProjectCharterDisplay.vue')

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

function compileSfcTemplate(filename: string) {
  const source = readFileSync(filename, 'utf8')
  const parsed = parse(source, { filename })
  if (!parsed.descriptor.template) throw new Error(`no template in ${filename}`)
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename,
    id: 'charter-test',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  if (compiled.errors.length) throw compiled.errors[0]
  const runnableCode = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  return new Function('Vue', runnableCode)(Vue) as RenderFunction
}

import { CHARTER_FIELD_KEYS, type CharterFieldKey } from '../../../utils/projectCharter'
import { CHARTER_STEP_FIELDS, charterStepsForType } from '../../../utils/charterSteps'

async function renderFields(fields: readonly CharterFieldKey[] = CHARTER_FIELD_KEYS) {
  const render = compileSfcTemplate(fieldsFilename)
  const visible = new Set<string>(fields)
  const component = defineComponent({
    setup: () => ({
      show: (field: string) => visible.has(field),
      typeStepLabels: ['justification'],
      draft: {
        name: 'Portal', description: '', userId: null, managerName: null, dateStart: null, dateEnd: null,
        typeId: 3, typeName: 'Technical', owningUnitId: 4, owningUnitName: 'PMO', sponsorId: 8, sponsorName: 'Noura',
        authority: 'Board', rationale: 'Why now', objectives: [{ key: 'o1', goal: 'Launch', metric: '', target: '', persisted: true }],
        benefits: 'Faster service', scope: 'Web app', exclusions: 'Mobile app', highLevelRequirements: 'SSO',
        deliverables: [{ key: 'd1', name: 'Legacy output', description: '', acceptance: 'Signed off', persisted: true }],
        success: 'Stable launch', budgetState: 'unknown', amountInput: '', currencyLabel: 'SAR', code: 'PRJ-1', priority: null,
        assumptions: '', constraints: '', closure: '', charterState: 'draft', typeSteps: ['justification'],
      },
      readonly: false,
      disabled: false,
      fieldErrors: {},
      requireManager: false,
      requireEndDate: false,
      controlsDisabled: false,
      hydrated: true,
      canManageSettings: false,
      typeOpen: false,
      unitOpen: false,
      typeQuery: '',
      typeItems: [],
      typeMenuItems: [],
      typesPending: false,
      typesHasMore: false,
      unitQuery: '',
      unitItems: [],
      unitMenuItems: [],
      unitsPending: false,
      unitsHasMore: false,
      startLabel: 'Not set',
      endLabel: 'Not set',
      descriptionLooksHtml: false,
      readonlyDescription: '',
      t: (key: string) => key,
      helpLabel: (key: string) => key,
      catalogSettingsPath: () => '#',
      onManagerResolve: () => {},
      onSponsorResolve: () => {},
      onTypeSelect: () => {},
      onUnitSelect: () => {},
      onBudgetState: () => {},
      loadMoreTypes: () => {},
      loadMoreUnits: () => {},
      PROJECT_PRIORITIES: ['low', 'normal', 'high', 'critical'],
    }),
    render,
  })
  const app = createSSRApp({ render: () => h(component) })
  for (const name of [
    'UInput', 'UTextarea', 'ProjectFieldHelp', 'UButton', 'USelectMenu', 'USelect', 'SharedDateField', 'NuxtLink',
    'UFormField', 'SharedPersonPicker', 'SharedRichText',
  ]) app.component(name, Passthrough)
  app.component('ProjectCharterRows', defineComponent({
    props: { showObjectives: Boolean, showDeliverables: Boolean },
    setup(props) {
      return () => h('div', [
        props.showObjectives ? h('div', { 'data-testid': 'charter-field-objectives' }) : null,
        props.showDeliverables ? h('div', { 'data-testid': 'charter-field-deliverables' }) : null,
      ])
    },
  }))
  return renderToString(app)
}

async function renderRows(sections: { showObjectives: boolean; showDeliverables: boolean }) {
  const render = compileSfcTemplate(rowsFilename)
  const component = defineComponent({
    setup: () => ({
      draft: {
        objectives: [{ key: 'o1', goal: 'Launch', metric: '', target: '', persisted: true }],
        deliverables: [{ key: 'd1', name: 'Legacy output', description: '', acceptance: 'Signed off', persisted: true }],
      },
      readonly: false,
      disabled: false,
      ...sections,
      pendingRemove: null,
      t: (key: string) => key,
      helpLabel: (key: string) => key,
      requestRemove: () => {},
      addObjective: () => {},
      addDeliverable: () => {},
      removeRow: () => {},
    }),
    render,
  })
  const app = createSSRApp({ render: () => h(component) })
  for (const name of ['UInput', 'UTextarea', 'ProjectFieldHelp', 'UButton']) app.component(name, Passthrough)
  return renderToString(app)
}

async function renderDisplay(options: { legacy?: boolean; loading?: boolean; error?: boolean } = {}) {
  const render = compileSfcTemplate(displayFilename)
  const component = defineComponent({
    setup: () => {
      const draft = {
        name: 'Portal', description: '', managerName: 'Sara', dateStart: null, dateEnd: null, code: 'PRJ-1',
        typeName: options.legacy ? 'Technical' : null, owningUnitName: null, sponsorName: options.legacy ? 'Noura' : null, authority: '', rationale: 'Why now',
        objectives: [] as ObjectiveDraft[], benefits: '', scope: 'Web app', exclusions: '', highLevelRequirements: '', deliverables: [] as DeliverableDraft[], success: '',
        budgetState: 'unknown', amountInput: '', currencyLabel: null, priority: null, assumptions: '', constraints: '', closure: '',
        charterState: 'draft', typeSteps: null,
      }
      const visibleObjectives = draft.objectives.filter(row => row.goal.trim() || row.metric.trim() || row.target.trim())
      const legacyDeliverables = draft.deliverables.filter(row => row.name.trim() || row.description.trim() || row.acceptance.trim())
      const hasLegacyDetails = Boolean(options.legacy || legacyDeliverables.length)
      return {
        draft,
        visibleObjectives,
        legacyDeliverables,
        hasLegacyDetails,
        milestones: [{ id: 4, name: 'Discovery', deliverables: [{ name: 'Brief', done: true }] }],
        milestoneOutputs: [{ milestoneId: 4, milestoneName: 'Discovery', name: 'Brief', done: true }],
        milestonesLoading: !!options.loading,
        milestonesError: options.error ? new Error('failed') : undefined,
        milestonesReady: !options.loading && !options.error,
        t: (key: string) => key,
        locale: 'en',
        display: (value: string | null | undefined) => value?.trim() || 'Not set',
        date: () => 'Not set',
        budgetAmount: () => 'Unknown',
        printCharter: () => {},
        emit: () => {},
      }
    },
    render,
  })
  const app = createSSRApp({ render: () => h(component) })
  app.component('UCard', defineComponent({
    inheritAttrs: false,
    setup(_, { slots, attrs }) {
      return () => h('div', attrs, [slots.header?.(), slots.default?.()])
    },
  }))
  app.component('UButton', Passthrough)
  app.component('UCheckbox', Passthrough)
  return renderToString(app)
}

describe('charter wizard steps', () => {
  it('renders only the fields of the basics step', async () => {
    const html = await renderFields(CHARTER_STEP_FIELDS.basics)
    for (const key of ['name', 'code', 'description', 'type', 'owning_unit', 'manager', 'sponsor']) {
      expect(html, key).toContain(`data-testid="charter-field-${key}"`)
    }
    expect(html).toContain('data-testid="charter-type-steps"')
    for (const key of ['rationale', 'objectives', 'scope', 'deliverables', 'date_end', 'budget_state', 'closure']) {
      expect(html, key).not.toContain(`data-testid="charter-field-${key}"`)
    }
  })

  it('renders the justification and scope steps with their child rows', async () => {
    const justification = await renderFields(CHARTER_STEP_FIELDS.justification)
    expect(justification).toContain('data-testid="charter-field-authority"')
    expect(justification).toContain('data-testid="charter-field-rationale"')
    expect(justification).toContain('data-testid="charter-field-objectives"')
    expect(justification).toContain('data-testid="charter-field-benefits"')
    expect(justification).not.toContain('data-testid="charter-field-deliverables"')
    expect(justification).not.toContain('data-testid="charter-field-name"')
    const scope = await renderFields(CHARTER_STEP_FIELDS.scope)
    expect(scope).toContain('data-testid="charter-field-scope"')
    expect(scope).toContain('data-testid="charter-field-exclusions"')
    expect(scope).toContain('data-testid="charter-field-high_level_requirements"')
    expect(scope).toContain('data-testid="charter-field-deliverables"')
    expect(scope).toContain('data-testid="charter-field-success"')
    expect(scope).not.toContain('data-testid="charter-field-objectives"')
  })

  it('renders schedule, budget and risks as separate steps', async () => {
    const schedule = await renderFields(CHARTER_STEP_FIELDS.schedule)
    expect(schedule).toContain('data-testid="charter-field-date_start"')
    expect(schedule).toContain('data-testid="charter-field-date_end"')
    expect(schedule).toContain('data-testid="charter-field-priority"')
    expect(schedule).not.toContain('data-testid="charter-field-amount"')
    const budget = await renderFields(CHARTER_STEP_FIELDS.budget)
    expect(budget).toContain('data-testid="charter-field-budget_state"')
    expect(budget).toContain('data-testid="charter-field-amount"')
    expect(budget).toContain('data-testid="charter-field-currency"')
    expect(budget).not.toContain('data-testid="charter-field-date_end"')
    const risks = await renderFields(CHARTER_STEP_FIELDS.risks)
    expect(risks).toContain('data-testid="charter-field-assumptions"')
    expect(risks).toContain('data-testid="charter-field-constraints"')
    expect(risks).toContain('data-testid="charter-field-closure"')
    expect(risks).not.toContain('data-testid="charter-field-budget_state"')
  })

  it('renders every commercial field when no step filter is given', async () => {
    const html = await renderFields()
    for (const key of CHARTER_FIELD_KEYS) {
      if (key === 'acceptance') continue // lives inside the deliverable rows stub
      expect(html, key).toContain(`data-testid="charter-field-${key}"`)
    }
  })

  it('walks the steps the chosen classification configures, framed by basics and review', () => {
    expect(charterStepsForType(null)).toEqual(['basics', 'justification', 'scope', 'schedule', 'budget', 'risks', 'review'])
    expect(charterStepsForType(['justification', 'scope', 'schedule'])).toEqual(['basics', 'justification', 'scope', 'schedule', 'review'])
    expect(charterStepsForType([])).toEqual(['basics', 'review'])
    const form = readFileSync(resolve(here, '../ProjectCharterForm.vue'), 'utf8')
    const fields = readFileSync(fieldsFilename, 'utf8')
    expect(form).toContain('UStepper')
    expect(form).toContain(':fields="currentFields"')
    expect(form).toContain('data-testid="charter-save-draft"')
    expect(form).toContain('data-testid="charter-review-step"')
    expect(form).toContain(':ignore-query-keys="[\'step\']"')
    expect(form).not.toContain('<details')
    expect(fields).not.toContain('<details')
    expect(fields).toContain('draft.value.typeSteps')
  })
})

describe('project charter document', () => {
  it('renders milestone checklist outputs and exposes a print action', async () => {
    const html = await renderDisplay()
    expect(html).toContain('Brief')
    expect(html).toContain('Discovery')
    expect(html).toContain('project-charter-print')
    expect(html).toContain('aria-label="Brief"')
    expect(html).not.toMatch(/approval|signature/i)
  })

  it('keeps populated historical advanced fields in expandable legacy details only', async () => {
    const compactHtml = await renderDisplay()
    const legacyHtml = await renderDisplay({ legacy: true })
    expect(compactHtml).not.toContain('projects.charter.legacyDetails')
    expect(legacyHtml).toContain('projects.charter.legacyDetails')
    expect(legacyHtml).toContain('Technical')
    expect(legacyHtml).toContain('Noura')
  })

  it('shows milestone failures and prevents printing while milestone data is unavailable', async () => {
    const loadingHtml = await renderDisplay({ loading: true })
    const errorHtml = await renderDisplay({ error: true })
    expect(loadingHtml).toContain('data-testid="charter-milestones-loading"')
    expect(loadingHtml).toMatch(/data-testid="project-charter-print"[^>]*disabled/)
    expect(errorHtml).toContain('data-testid="charter-milestones-error"')
    expect(errorHtml).toMatch(/data-testid="project-charter-print"[^>]*disabled/)
  })
})

describe('charter rows', () => {
  it('renders only the objectives section on the justification step', async () => {
    const html = await renderRows({ showObjectives: true, showDeliverables: false })
    expect(html).toContain('data-testid="charter-field-objectives"')
    expect(html).not.toContain('data-testid="charter-field-deliverables"')
  })

  it('renders only the deliverables section on the scope step', async () => {
    const html = await renderRows({ showObjectives: false, showDeliverables: true })
    expect(html).not.toContain('data-testid="charter-field-objectives"')
    expect(html).toContain('data-testid="charter-field-deliverables"')
    expect(html).toContain('data-testid="charter-field-acceptance"')
  })
})
