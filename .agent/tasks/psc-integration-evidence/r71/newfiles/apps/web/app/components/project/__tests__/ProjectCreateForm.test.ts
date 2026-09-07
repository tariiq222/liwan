import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../ProjectCreateForm.vue')
const source = readFileSync(filename, 'utf8')
const settingsSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../composables/useProjectSettings.ts'), 'utf8')

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

function loadForm(setup: () => Record<string, unknown>) {
  const parsed = parse(source, { filename })
  if (!parsed.descriptor.template) throw new Error('no template')
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename,
    id: 'project-create',
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
  for (const name of ['Button', 'Label', 'Input', 'Popover', 'PopoverTrigger', 'PopoverContent', 'Command', 'CommandList', 'CommandEmpty', 'CommandGroup', 'CommandItem', 'Calendar', 'Check']) {
    app.component(name, Passthrough)
  }
  return renderToString(app)
}

const t = (key: string) => key

describe('ProjectCreateForm production template', () => {
  it('invalidates create-defaults after settings patch using the dedicated query key', () => {
    expect(settingsSource).toContain('projectSettingsKeys.createDefaults')
    expect(settingsSource).toMatch(/invalidateQueries\(\{\s*queryKey:\s*projectSettingsKeys\.createDefaults/)
  })

  it('blocks submit while defaults are unavailable and shows retry', async () => {
    const html = await renderForm(() => ({
      t,
      defaultsLoading: true,
      forbidden: false,
      defaultsFailed: false,
      defaultsReady: false,
      defaultsFetching: false,
      requireManager: true,
      requireEndDate: true,
      hydrated: true,
      isPending: false,
      submitBlocked: true,
      name: 'Keep me',
      managerName: 'Mona',
      endLabel: 'projects.create.chooseEndDate',
      error: null,
      managerOpen: false,
      managerQ: '',
      managerId: 7,
      people: [],
      endValue: null,
      retryDefaults: () => {},
      selectManager: () => {},
      submit: () => {},
    }))
    expect(html).toContain('data-testid="project-create-loading"')
    expect(html).toContain('data-testid="project-create-submit"')
    expect(html).toContain('disabled')
    expect(html).toContain('Keep me')
  })

  it('shows forbidden instead of failing open', async () => {
    const html = await renderForm(() => ({
      t,
      defaultsLoading: false,
      forbidden: true,
      defaultsFailed: true,
      defaultsReady: false,
      defaultsFetching: false,
      requireManager: false,
      requireEndDate: false,
      hydrated: true,
      isPending: false,
      submitBlocked: true,
      name: 'Kept',
      managerName: 'projects.settings.noManager',
      endLabel: 'projects.create.chooseEndDate',
      error: null,
      managerOpen: false,
      managerQ: '',
      managerId: null,
      people: [],
      endValue: null,
      retryDefaults: () => {},
      selectManager: () => {},
      submit: () => {},
    }))
    expect(html).toContain('data-testid="project-create-forbidden"')
    expect(html).toContain('projects.createForbidden')
    expect(html).not.toContain('data-testid="project-create-retry"')
  })

  it('marks required manager and end date on accessible labels', async () => {
    const html = await renderForm(() => ({
      t,
      defaultsLoading: false,
      forbidden: false,
      defaultsFailed: false,
      defaultsReady: true,
      defaultsFetching: false,
      requireManager: true,
      requireEndDate: true,
      hydrated: true,
      isPending: false,
      submitBlocked: false,
      name: 'P',
      managerName: 'Sara',
      endLabel: 'projects.create.chooseEndDate',
      error: null,
      managerOpen: false,
      managerQ: '',
      managerId: 9,
      people: [],
      endValue: null,
      retryDefaults: () => {},
      selectManager: () => {},
      submit: () => {},
    }))
    expect(html).toContain('aria-required="true"')
    expect(html).toContain('Sara')
    expect(html).toContain('projects.create.chooseEndDate')
  })
})
