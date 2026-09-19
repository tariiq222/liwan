import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { chromium, type Browser, type Page } from 'playwright'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '../../../../')
const root = resolve(here, '../../../pages/projects/[id]')
const raciPath = resolve(root, 'raci.vue')
const raci = readFileSync(raciPath, 'utf8')
const vueGlobal = resolve(webRoot, '../../node_modules/vue/dist/vue.global.js')

const parsed = parse(raci, { filename: raciPath })
if (!parsed.descriptor.template) throw new Error('raci.vue has no template')
const compiled = compileTemplate({
  source: parsed.descriptor.template.content,
  filename: raciPath,
  id: 'raci-page',
  compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
})
if (compiled.errors.length) throw compiled.errors[0]
const renderCode = ts.transpileModule(compiled.code, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText

const changeRoleSource = raci.slice(raci.indexOf('async function changeRole'), raci.indexOf('async function deleteRow'))
const changeRoleJs = ts.transpileModule(changeRoleSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText

describe('RACI role select authoritative value', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
  }, 30000)

  afterAll(async () => {
    await browser?.close()
  })

  async function mountMatrix(role: 'R' | 'A', mode: 'cancel' | 'fail' | 'succeed') {
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ path: vueGlobal })
    await page.evaluate(({ renderCode, changeRoleJs, role, mode }) => {
      const Vue = (globalThis as unknown as { Vue: typeof import('vue') }).Vue
      const render = new Function('Vue', renderCode)(Vue) as () => unknown
      const Passthrough = {
        inheritAttrs: false,
        setup(_props: unknown, ctx: { slots: { default?: () => unknown }, attrs: Record<string, unknown> }) {
          return () => Vue.h('div', ctx.attrs, ctx.slots.default?.() as never)
        },
      }
      const Button = {
        inheritAttrs: false,
        setup(_props: unknown, ctx: { slots: { default?: () => unknown }, attrs: Record<string, unknown> }) {
          return () => Vue.h('button', { type: 'button', ...ctx.attrs }, ctx.slots.default?.() as never)
        },
      }
      const row = Vue.ref({
        id: 9,
        role: role as string,
        task: { id: 1, name: 'Design' },
        stakeholder: { id: 2, name: 'Sponsor' },
      })
      const error = Vue.ref<string | null>(null)
      const confirmRow = Vue.ref<typeof row.value | null>(null)
      const t = (key: string) => key
      function assignment() { return row.value.role ? row.value : undefined }
      let release = () => {}
      const held = mode === 'succeed' ? new Promise<void>(resolve => { release = resolve }) : Promise.resolve()
      ;(globalThis as { __releaseRaci?: () => void }).__releaseRaci = release
      class ApiError extends Error {}
      const update = {
        mutateAsync: async ({ body }: { body: { role: string } }) => {
          await held
          if (mode === 'fail') throw new Error('denied')
          row.value = { ...row.value, role: body.role }
        },
      }
      const create = { mutateAsync: async () => undefined }
      const id = Vue.ref(7)
      const changeRole = new Function(
        'assignment', 'error', 'confirmRow', 'update', 'create', 'id', 't', 'ApiError', 'pending', 'loading',
        `${changeRoleJs}\nreturn changeRole;`,
      )(assignment, error, confirmRow, update, create, id, t, ApiError, Vue.ref(false), Vue.ref(false))
      const app = Vue.createApp({
        setup() {
          return {
            t,
            id: id.value,
            hydrated: true,
            pending: false,
            loading: false,
            taskSearch: '',
            stakeholderSearch: '',
            closed: false,
            error,
            confirmRow,
            deleteRow: async () => undefined,
            tasks: { isLoading: { value: false }, error: { value: null }, data: { value: { total: 1 } }, refetch() {}, isFetching: { value: false } },
            stakeholders: { isLoading: { value: false }, error: { value: null }, data: { value: { total: 1 } }, refetch() {}, isFetching: { value: false } },
            rows: { isLoading: { value: false }, error: { value: null }, data: { value: { can_manage: true, items: [row.value] } }, refetch() {}, isFetching: { value: false } },
            visibleTasks: [{ id: 1, name: 'Design' }],
            visibleStakeholders: [{ id: 2, name: 'Sponsor' }],
            assignment,
            roleColor: () => undefined,
            changeRole,
            taskPage: 0,
            stakeholderPage: 0,
            nextTasks() {},
            route: { fullPath: '/projects/7/raci' },
          }
        },
        render,
      })
      app.component('SharedPageContainer', Passthrough)
      app.component('SharedPageHeader', Passthrough)
      app.component('SharedPageState', Passthrough)
      app.component('Label', Passthrough)
      app.component('Input', Passthrough)
      app.component('UButton', Button)
      // Mirrors SharedInlineConfirm's contract: attrs on the root, cancel first, then the action.
      app.component('SharedInlineConfirm', {
        inheritAttrs: false,
        props: { title: String, description: String, confirmLabel: String, pending: Boolean },
        emits: ['confirm', 'cancel'],
        setup(props: { title?: string; description?: string; confirmLabel?: string }, ctx: { attrs: Record<string, unknown>; emit: (event: 'confirm' | 'cancel') => void }) {
          return () => Vue.h('div', ctx.attrs, [
            Vue.h('p', props.title),
            Vue.h('p', props.description),
            Vue.h('button', { type: 'button', onClick: () => ctx.emit('cancel') }, 'app.cancel'),
            Vue.h('button', { type: 'button', onClick: () => ctx.emit('confirm') }, props.confirmLabel),
          ])
        },
      })
      // Controlled primitive stub: only emits the chosen value. The production
      // changeRole handler and assignment state decide what remains displayed.
      app.component('USelect', Vue.defineComponent({
        inheritAttrs: false,
        props: { modelValue: { type: String, required: true }, items: { type: Array as import('vue').PropType<{ value: string; label: string }[]>, required: true } },
        emits: ['update:modelValue'],
        setup(props, { attrs, emit }) {
          return () => Vue.h('div', [
            Vue.h('button', { ...attrs, 'data-raci-select': '' }, props.modelValue),
            ...props.items.map(item => Vue.h('button', { 'data-option': item.value, onClick: () => emit('update:modelValue', item.value) }, item.label)),
          ])
        },
      }))
      app.component('NuxtLink', {
        props: { to: { type: [String, Object], default: '#' } },
        setup(_props: unknown, ctx: { slots: { default?: () => unknown } }) {
          return () => Vue.h('a', { href: '#' }, ctx.slots.default?.() as never)
        },
      })
      app.mount('#app')
    }, { renderCode, changeRoleJs, role, mode })
  }

  function roleSelect() {
    return page.locator('[data-raci-select][aria-label="Design — Sponsor — projects.governance.raci.role"]')
  }

  it('resets a cleared R assignment and restores it on cancel', async () => {
    await mountMatrix('R', 'cancel')
    const select = roleSelect()
    expect(await select.textContent()).toBe('R')
    await page.locator('[data-option="none"]').click()
    expect(await select.textContent()).toBe('R')
    expect(await page.getByRole('group', { name: 'projects.governance.confirmDelete' }).count()).toBe(1)
    await page.locator('button', { hasText: 'app.cancel' }).click()
    expect(await page.getByRole('group', { name: 'projects.governance.confirmDelete' }).count()).toBe(0)
    expect(await select.textContent()).toBe('R')
  }, 20000)

  it('resets a cleared A assignment and restores it on cancel', async () => {
    await mountMatrix('A', 'cancel')
    const select = roleSelect()
    expect(await select.textContent()).toBe('A')
    await page.locator('[data-option="none"]').click()
    expect(await select.textContent()).toBe('A')
    await page.locator('button', { hasText: 'app.cancel' }).click()
    expect(await select.textContent()).toBe('A')
  }, 20000)

  it('keeps the current role and shows an error when the mutation fails', async () => {
    await mountMatrix('R', 'fail')
    const select = roleSelect()
    await page.locator('[data-option="A"]').click()
    expect(await select.textContent()).toBe('R')
    await expect.poll(async () => page.locator('[role="alert"]').textContent()).toBe('errors.generic')
  }, 20000)

  it('keeps the current role while a mutation is pending, then shows the saved role', async () => {
    await mountMatrix('R', 'succeed')
    const select = roleSelect()
    await page.locator('[data-option="C"]').click()
    expect(await select.textContent()).toBe('R')
    await page.evaluate(() => (globalThis as { __releaseRaci?: () => void }).__releaseRaci?.())
    await expect.poll(async () => select.textContent()).toBe('C')
  }, 20000)
})
