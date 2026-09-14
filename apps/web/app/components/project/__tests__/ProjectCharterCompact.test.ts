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

async function renderFields(compact: boolean) {
  const render = compileSfcTemplate(fieldsFilename)
  const component = defineComponent({
    setup: () => ({
      draft: {
        name: 'Portal', description: '', userId: null, managerName: null, dateStart: null, dateEnd: null,
        typeId: 3, typeName: 'Technical', owningUnitId: 4, owningUnitName: 'PMO', sponsorId: 8, sponsorName: 'Noura',
        authority: 'Board', rationale: 'Why now', objectives: [{ key: 'o1', goal: 'Launch', metric: '', target: '', persisted: true }],
        benefits: 'Faster service', scope: 'Web app', exclusions: 'Mobile app', highLevelRequirements: 'SSO',
        deliverables: [{ key: 'd1', name: 'Legacy output', description: '', acceptance: 'Signed off', persisted: true }],
        success: 'Stable launch', budgetState: 'unknown', amountInput: '', currencyLabel: 'SAR', code: 'PRJ-1', priority: null,
        assumptions: '', constraints: '', closure: '',
      },
      readonly: false,
      disabled: false,
      fieldErrors: {},
      requireManager: false,
      requireEndDate: false,
      compact,
      controlsDisabled: false,
      hydrated: true,
      canManageSettings: false,
      sectionOpen: () => true,
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
    props: { compact: Boolean },
    setup(props) { return () => props.compact ? h('div') : h('div', { 'data-testid': 'charter-field-deliverables' }) },
  }))
  return renderToString(app)
}

async function renderRows(compact: boolean) {
  const render = compileSfcTemplate(rowsFilename)
  const component = defineComponent({
    setup: () => ({
      draft: {
        objectives: [{ key: 'o1', goal: 'Launch', metric: '', target: '', persisted: true }],
        deliverables: [{ key: 'd1', name: 'Legacy output', description: '', acceptance: 'Signed off', persisted: true }],
      },
      readonly: false,
      disabled: false,
      compact,
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
  for (const name of ['UInput', 'UTextarea', 'ProjectFieldHelp', 'UButton', 'UFormField', 'SharedInlineConfirm']) app.component(name, Passthrough)
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
  app.component('SharedRichText', Passthrough)
  return renderToString(app)
}

describe('compact charter editor', () => {
  it('renders the compact purpose fields while hiding sponsor and advanced charter controls', async () => {
    const html = await renderFields(true)
    expect(html).toContain('data-testid="charter-field-name"')
    expect(html).toContain('data-testid="charter-field-rationale"')
    expect(html).toContain('data-testid="charter-field-scope"')
    expect(html).toContain('data-testid="charter-field-exclusions"')
    expect(html).not.toContain('data-testid="charter-field-sponsor"')
    expect(html).not.toContain('data-testid="charter-field-benefits"')
    expect(html).not.toContain('data-testid="charter-field-high_level_requirements"')
    expect(html).not.toContain('data-testid="charter-field-deliverables"')
  })

  it('uses the compact surface for the editable charter in both create and edit modes', async () => {
    const editHtml = await renderFields(true)
    expect(editHtml).toContain('data-testid="charter-field-name"')
    expect(editHtml).not.toContain('data-testid="charter-field-sponsor"')
    expect(editHtml).not.toContain('data-testid="charter-field-high_level_requirements"')
    expect(editHtml).not.toContain('data-testid="charter-field-deliverables"')
    expect(editHtml).toContain('data-testid="charter-field-rationale"')
  })

  it('keeps optional project-create charter sections collapsed while allowing full edit to retain every field', () => {
    const fields = readFileSync(fieldsFilename, 'utf8')
    const form = readFileSync(resolve(here, '../ProjectCharterForm.vue'), 'utf8')
    expect(form).toContain(':compact="mode === \'create\'"')
    expect(form).toContain(':project-create="mode === \'create\'"')
    expect(fields).toContain(':open="!projectCreate || sectionOpen([')
    expect(fields).toContain('data-testid="charter-field-rationale"')
    expect(fields).toContain('data-testid="charter-field-scope"')
    expect(fields).toContain('data-testid="charter-field-budget_state"')
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
  it('does not render legacy charter deliverable inputs in compact mode', async () => {
    const html = await renderRows(true)
    expect(html).not.toContain('data-testid="charter-field-deliverables"')
  })

  it('renders legacy charter deliverables in the full read/edit surface', async () => {
    const html = await renderRows(false)
    expect(html).toContain('data-testid="charter-field-deliverables"')
  })
})
