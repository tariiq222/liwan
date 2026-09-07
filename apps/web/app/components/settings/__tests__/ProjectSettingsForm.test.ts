import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../ProjectSettingsForm.vue')
const source = readFileSync(filename, 'utf8')
const settingsSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../composables/useProjectSettings.ts'), 'utf8')

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

const PageState = defineComponent({
  props: { loading: Boolean, error: { type: Object, default: undefined } },
  setup(props, { slots }) {
    return () => props.error ? h('div', ['errors.generic', 'app.retry']) : h('div', slots.default?.())
  },
})

function loadForm(setup: () => Record<string, unknown>) {
  const parsed = parse(source, { filename })
  if (!parsed.descriptor.template) throw new Error('no template')
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename,
    id: 'project-settings',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  const runnableCode = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const render = new Function('Vue', runnableCode)(Vue) as RenderFunction
  return defineComponent({ setup, render })
}

async function renderForm(setup: () => Record<string, unknown>) {
  const app = createSSRApp({ render: () => h(loadForm(setup)) })
  for (const name of ['Skeleton', 'Label', 'RadioGroup', 'RadioGroupItem', 'StageListEditor', 'Input']) {
    app.component(name, Passthrough)
  }
  app.component('SharedPageState', PageState)
  return renderToString(app)
}

describe('ProjectSettingsForm production template', () => {
  it('refreshes create defaults from the dedicated query key after a settings patch', () => {
    expect(settingsSource).toContain("createDefaults: ['project-settings', 'create-defaults']")
    expect(settingsSource).toContain('invalidateQueries({ queryKey: projectSettingsKeys.createDefaults })')
  })

  it('renders create and reminder controls from loaded settings', async () => {
    const html = await renderForm(() => ({
      t: (key: string) => key,
      isLoading: false,
      error: undefined,
      hydrated: true,
      isPending: false,
      settings: {
        project_creators: 'managers',
        default_stages: [{ name: 'A', fold: false }],
        require_manager_on_create: true,
        require_end_date_on_create: true,
        default_completion_approval: 'none',
        deadline_reminders_enabled: true,
        deadline_reminders_days_before: 1,
        overdue_digest_enabled: true,
      },
      rows: [{ id: 's-0', name: 'A', fold: false }],
      CREATOR_OPTIONS: [
        { value: 'managers', labelKey: 'settings.projects.creators.managers' },
        { value: 'employees', labelKey: 'settings.projects.creators.employees' },
      ],
      onCreatorsChange: () => {},
      onBool: () => {},
      onApprovalDefault: () => {},
      onDaysBefore: () => {},
      onAddStage: () => {},
      onRenameStage: () => {},
      onFoldStage: () => {},
      onReorderStages: () => {},
      onDeleteStage: () => {},
    }))
    expect(html).toContain('settings.projects.createRequirements.manager')
    expect(html).toContain('settings.projects.approval.hint')
    expect(html).toContain('settings.projects.reminders.digest')
  })

  it('renders an actionable error state when the initial settings query fails', async () => {
    const html = await renderForm(() => ({
      t: (key: string) => key,
      isLoading: false,
      error: new Error('settings unavailable'),
      hydrated: true,
      isPending: false,
      settings: undefined,
      rows: [],
      CREATOR_OPTIONS: [],
      onCreatorsChange: () => {},
      onBool: () => {},
      onApprovalDefault: () => {},
      onDaysBefore: () => {},
      onAddStage: () => {},
      onRenameStage: () => {},
      onFoldStage: () => {},
      onReorderStages: () => {},
      onDeleteStage: () => {},
      refetch: () => {},
    }))
    expect(html).toContain('errors.generic')
    expect(html).toContain('app.retry')
    expect(html).not.toContain('settings.projects.defaultStages.label')
  })
})
