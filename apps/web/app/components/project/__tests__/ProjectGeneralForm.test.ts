import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import type { ProjectDetail } from '@nasq/contracts'
import ts from 'typescript'
import * as Vue from 'vue'
import { computed, createSSRApp, defineComponent, h, ref, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../ProjectGeneralForm.vue')
const source = readFileSync(filename, 'utf8')

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

function loadForm() {
  const parsed = parse(source, { filename })
  if (!parsed.descriptor.template) throw new Error('no template')
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename,
    id: 'project-general',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  const runnableCode = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const render = new Function('Vue', runnableCode)(Vue) as RenderFunction
  return defineComponent({
    props: { project: { type: Object, required: true } },
    setup(props) {
      const project = computed(() => props.project as ProjectDetail)
      const t = (key: string) => key
      const hydrated = true
      const nameDraft = ref(project.value.name)
      const displayedMode = computed(() => project.value.completion_approval)
      const pendingMode = ref<'none' | 'project_manager' | 'specific_user' | null>(
        project.value.completion_approval === 'specific_user' && !project.value.completion_approver ? 'specific_user' : null,
      )
      const approvalLocked = false
      const approvalError = null
      const displayedApproverName = computed(() => project.value.completion_approver?.name ?? 'projects.settings.noApprover')
      const approverItems = computed(() => (project.value.completion_approver ? [project.value.completion_approver] : []))
      const endLabel = computed(() => project.value.date_end ?? 'projects.settings.noDate')
      const startLabel = computed(() => project.value.date_start ?? 'projects.settings.noDate')
      const hasAnyDate = computed(() => !!project.value.date_start || !!project.value.date_end)
      return {
        project, t, hydrated, nameDraft, displayedMode, pendingMode, approvalLocked, approvalError,
        displayedApproverName, approverItems, endLabel, startLabel, hasAnyDate,
        managerOpen: false, managerQ: '', people: [], approverOpen: false, approverQ: '',
        approverPeople: [], startValue: null, endValue: null,
        commitName: () => {}, onDescriptionChange: () => {}, selectManager: () => {},
        onVisibilityChange: () => {}, onStartChange: () => {}, onEndChange: () => {},
        clearDates: () => {}, onTagsChange: () => {}, onApprovalChange: () => {},
        selectApprover: () => {}, cancelPendingApproval: () => {},
      }
    },
    render,
  })
}

const project: ProjectDetail = {
  id: 4, name: 'Portal', status: null, progress: 0, task_count: 0, closed_task_count: 0,
  active: true, can_manage: true, allowed_actions: ['read', 'write'], stages: [],
  description_html: '', manager: { id: 2, name: 'Mona' }, privacy_visibility: 'employees',
  date_start: null, date_end: '2031-06-30', tags: [], followers_count: 0, milestone_count: 0,
  allow_task_dependencies: false, completion_approval: 'none', completion_approver: null,
  updated_at: 'v1',
  charter: {
    code: 'PRJ-000004', type: null, owning_unit: null, sponsor: null,
    authority: '', rationale: '', objectives: [], benefits: '', scope: '', exclusions: '',
    high_level_requirements: '', deliverables: [], success: '', budget_state: 'unknown',
    amount: null, currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 },
    priority: null, assumptions: '', constraints: '', closure: '',
  },
}

async function renderGeneral(value: ProjectDetail) {
  const app = createSSRApp({ render: () => h(loadForm(), { project: value }) })
  for (const name of ['UButton', 'USelect', 'USelectMenu', 'USwitch', 'USeparator', 'TagPicker', 'DescriptionEditor', 'UFormField']) {
    app.component(name, Passthrough)
  }
  return renderToString(app)
}

describe('ProjectGeneralForm production template', () => {
  it('keeps charter identity and date fields out of operational settings', async () => {
    expect(source).not.toContain('project-settings-name')
    expect(source).not.toContain('project-settings-manager')
    expect(source).not.toContain('project-settings-date-start')
    expect(source).not.toContain('DescriptionEditor')
    expect(source).toContain('allow_task_dependencies')
    expect(source).toContain('TagPicker')
    const html = await renderGeneral(project)
    expect(html).not.toContain('2031-06-30')
  })

  it('keeps specific_user pending until a person is chosen and exposes cancel', async () => {
    const html = await renderGeneral({
      ...project,
      completion_approval: 'specific_user',
      completion_approver: null,
    })
    expect(html).toContain('data-testid="project-approval-cancel"')
    expect(html).toContain('projects.settings.approverEligibility')
    expect(source).toMatch(/pendingMode\.value = mode/)
    expect(source).toMatch(/saveApproval\('specific_user'/)
  })
})
