import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import type { ProjectDetail } from '@liwan/contracts'
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
      const pendingMode = ref<'specific_user' | null>(
        project.value.completion_approval === 'specific_user' && !project.value.completion_approver ? 'specific_user' : null,
      )
      return {
        project, t, displayedMode: computed(() => project.value.completion_approval),
        displayedApprover: computed(() => project.value.completion_approver),
        approverItems: computed(() => project.value.completion_approver ? [project.value.completion_approver] : []),
        choosingApprover: computed(() => pendingMode.value === 'specific_user'),
        controlsLocked: false, dirty: false, saveState: 'idle', saveError: '',
        pendingPatch: null, pendingTags: null, approverQ: '',
        patch: () => {}, save: () => {}, onVisibilityChange: () => {},
        onTagsChange: () => {}, onApprovalChange: () => {},
        selectApprover: () => {}, cancelPendingApproval: () => {},
      }
    },
    render,
  })
}

const project: ProjectDetail = {
  id: 4, name: 'Portal', status: null, progress: 0, task_count: 0, closed_task_count: 0,
  active: true, can_manage: true, allowed_actions: ['read', 'write'], stages: [], charter_state: 'draft', phase: 'initiating', phase_state: { current: 'initiating', next: 'planning', previous: null, next_checks: [] }, change_control_mode: 'optional',
  description_html: '', manager: { id: 2, name: 'Mona' }, privacy_visibility: 'employees',
  date_start: null, date_end: '2031-06-30', tags: [], followers_count: 0, milestone_count: 0,
  allow_task_dependencies: false, completion_approval: 'none', completion_approver: null,
  updated_at: 'v1',
  charter: {
    code: 'PRJ-000004', type: null, owning_unit: null, sponsor: null,
    authority: '', rationale: '', objectives: [], benefits: '', scope: '', exclusions: '',
    high_level_requirements: '', deliverables: [], success: '', budget_state: 'unknown',
    amount: null, currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 },
    priority: null, assumptions: '', constraints: '', closure: '', state: 'draft' as const,
    approval_required: false, can_review: false, submitted_by: null, submitted_at: null,
    approved_by: null, approved_at: null, return_note: '',
  },
}

async function renderGeneral(value: ProjectDetail) {
  const app = createSSRApp({ render: () => h(loadForm(), { project: value }) })
  for (const name of ['UButton', 'USelect', 'USelectMenu', 'USwitch', 'USeparator', 'TagPicker', 'UFormField', 'UAlert', 'SharedUnsavedChanges']) {
    app.component(name, Passthrough)
  }
  return renderToString(app)
}

describe('ProjectGeneralForm production template', () => {
  it('keeps charter identity and date fields out of operational settings', async () => {
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
  })
})
