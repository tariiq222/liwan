import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type PropType, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'
import type { ProjectCreateDefaults } from '@liwan/contracts'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../ProjectCreateForm.vue')
const source = readFileSync(filename, 'utf8')
const settingsSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../composables/useProjectSettings.ts'), 'utf8')

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

const NuxtLinkStub = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup(props, { slots }) {
    return () => h('a', {
      href: typeof props.to === 'string' ? props.to : String((props.to as { path?: string }).path ?? ''),
    }, slots.default?.())
  },
})

const CharterFormStub = defineComponent({
  props: {
    createDefaults: { type: Object as PropType<ProjectCreateDefaults>, required: false },
    disabled: { type: Boolean, default: false },
  },
  setup(props) {
    return () => h('form', { 'data-testid': 'project-create-form' }, [
      h('button', {
        'data-testid': 'project-create-manager',
        'aria-required': String(props.createDefaults?.require_manager_on_create),
      }, 'manager'),
      h('button', {
        'data-testid': 'project-create-end-date',
        'aria-required': String(props.createDefaults?.require_end_date_on_create),
      }, 'end'),
      h('button', { 'data-testid': 'project-create-submit', disabled: props.disabled }, 'submit'),
    ])
  },
})

const CopyFormStub = defineComponent({
  props: { sourceId: { type: Number, required: true } },
  setup(props) {
    return () => h('div', { 'data-testid': 'project-copy-form', 'data-source-id': String(props.sourceId) })
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
  app.component('UButton', Passthrough)
  app.component('ProjectCharterForm', CharterFormStub)
  app.component('ProjectCopyForm', CopyFormStub)
  app.component('SharedFormSection', Passthrough)
  app.component('NuxtLink', NuxtLinkStub)
  return renderToString(app)
}

const t = (key: string) => key
const DEFAULTS: ProjectCreateDefaults = {
  require_manager_on_create: true,
  require_end_date_on_create: true,
  default_manager_id: 7,
}

describe('ProjectCreateForm production template', () => {

  it('blocks the merged form while defaults are unavailable and shows loading', async () => {
    const html = await renderForm(() => ({
      t,
      route: { fullPath: '/projects/new' },
      copyFrom: null,
      returnToQuery: () => ({}),
      defaultsLoading: true,
      defaults: undefined,
      defaultsFailed: false,
      defaultsFetching: false,
      hydrated: true,
      defaultManagerName: 'Mona',
      retryDefaults: () => {},
      emit: () => {},
    }))
    expect(html).toContain('data-testid="project-create-loading"')
    expect(html).toContain('data-testid="project-create-form"')
    expect(html).toContain('data-testid="project-create-submit" disabled')
  })

  it('passes required manager and end-date policy into the rendered merged form', async () => {
    const html = await renderForm(() => ({
      t,
      route: { fullPath: '/projects/new' },
      copyFrom: null,
      returnToQuery: () => ({}),
      defaultsLoading: false,
      defaults: DEFAULTS,
      defaultsFailed: false,
      defaultsFetching: false,
      hydrated: true,
      defaultManagerName: 'Mona',
      retryDefaults: () => {},
      emit: () => {},
    }))
    expect(html).toContain('data-testid="project-create-form"')
    expect(html).toContain('data-testid="project-create-submit"')
    expect(html).toContain('data-testid="project-create-manager" aria-required="true"')
    expect(html).toContain('data-testid="project-create-end-date" aria-required="true"')
  })

  it('has no template entry point', async () => {
    const html = await renderForm(() => ({
      t,
      route: { fullPath: '/projects/new' },
      copyFrom: null,
      defaultsLoading: false,
      defaults: DEFAULTS,
      defaultsFailed: false,
      defaultsFetching: false,
      hydrated: true,
      defaultManagerName: 'Mona',
      retryDefaults: () => {},
      emit: () => {},
    }))
    expect(html).not.toMatch(/template/i)
    expect(html).not.toContain('data-testid="project-copy-form"')
  })

  it('shows the copy form instead of the charter form when copyFrom is a valid id', async () => {
    const html = await renderForm(() => ({
      t,
      route: { fullPath: '/projects/new?copyFrom=12' },
      copyFrom: 12,
      defaultsLoading: false,
      defaults: DEFAULTS,
      defaultsFailed: false,
      defaultsFetching: false,
      hydrated: true,
      defaultManagerName: 'Mona',
      retryDefaults: () => {},
      emit: () => {},
    }))
    expect(html).toContain('data-testid="project-copy-form"')
    expect(html).toContain('data-source-id="12"')
    expect(html).toContain('projects.copy.title')
    expect(html).not.toContain('data-testid="project-create-form"')
  })

  it('reads copyFrom from the route query, ignoring malformed ids', () => {
    expect(source).toContain('parsePositiveId(route.query.copyFrom)')
  })
})
