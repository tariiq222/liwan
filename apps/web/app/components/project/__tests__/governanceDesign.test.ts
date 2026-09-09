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
const stakeholders = readFileSync(resolve(root, 'stakeholders/index.vue'), 'utf8')
const raciPath = resolve(root, 'raci.vue')
const raci = readFileSync(raciPath, 'utf8')
const projects = readFileSync(resolve(here, '../../../pages/projects/index.vue'), 'utf8')
const inputSource = readFileSync(resolve(here, '../../ui/input/Input.vue'), 'utf8')
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

describe('governance list/matrix design', () => {
  it('matches projects toolbar and table primitives on the stakeholder list', () => {
    expect(projects).toContain(':active-count="activeFilterCount"')
    expect(projects).toContain('FilterBar')
    expect(inputSource).toContain('h-[40px]')
    expect(stakeholders).toContain(':active-count="activeFilterCount"')
    expect(stakeholders).toContain('FilterBar')
    expect(stakeholders).toContain('<Search')
    expect(stakeholders).toContain('h-[40px]')
    expect(stakeholders).toContain('<Table>')
    expect(stakeholders).toContain('<TableHeader>')
    expect(stakeholders).toContain('<TableBody>')
    expect(stakeholders).toContain('list.data.value?.can_manage && hydrated')
    expect(stakeholders).toContain('!hydrated || remove.isPending.value')
    expect(stakeholders).toContain('router.replace({ query: { ...route.query, [key]: value || undefined, offset: undefined } })')
    expect(stakeholders).toContain('offset: String(Math.max(0, (parsed.value.offset ?? 0) + delta * 50))')
    expect(stakeholders).toContain('confirmDeleteId.value !== item.id')
    expect(stakeholders).toContain("cause.code === 'stakeholder_assigned'")
    expect(stakeholders).not.toContain('<table')
    expect(stakeholders).not.toContain('nasq-input')
  })

  it('styles RACI role controls without cloning list topology onto the matrix', () => {
    expect(raci).toContain('<select')
    expect(raci).toContain("select.value = row?.role ?? ''")
    expect(raci).toContain('@change="changeRole(task.id, item.id, $event)"')
    expect(raci).toContain('h-[40px]')
    expect(raci).not.toContain('h-9')
    expect(raci).toContain('v-for="task in visibleTasks"')
    expect(raci).toContain('v-for="item in visibleStakeholders"')
    expect(raci).toContain('rows.data.value?.can_manage')
    expect(raci).toContain('!hydrated || pending || loading || !!confirmRow')
    expect(raci).toContain('task_q')
    expect(raci).toContain('stakeholder_q')
    expect(raci).toContain('task_page')
    expect(raci).toContain('stakeholder_page')
    expect(raci).toContain('confirmRow.value = row')
    expect(raci).not.toContain('nasq-input')
    expect(raci).not.toContain('NativeSelect')
    expect(raci).toContain('<FilterBar')
    expect(raci).toContain('@clear="clearFilters"')
    expect(raci).toContain(':active-count="activeFilterCount"')
    expect(raci).not.toContain('nasq-toolbar')
    expect(raci).not.toContain('<Table>')
  })
})

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
        'assignment', 'error', 'confirmRow', 'update', 'create', 'id', 't', 'ApiError',
        `${changeRoleJs}\nreturn changeRole;`,
      )(assignment, error, confirmRow, update, create, id, t, ApiError)
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
      app.component('Button', Button)
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
    return page.locator('select[aria-label="Design — Sponsor — projects.governance.raci.role"]')
  }

  it('resets a cleared R assignment and restores it on cancel', async () => {
    await mountMatrix('R', 'cancel')
    const select = roleSelect()
    expect(await select.inputValue()).toBe('R')
    await select.selectOption('')
    expect(await select.inputValue()).toBe('R')
    expect(await page.getByRole('group', { name: 'projects.governance.confirmDelete' }).count()).toBe(1)
    await page.locator('button', { hasText: 'app.cancel' }).click()
    expect(await page.getByRole('group', { name: 'projects.governance.confirmDelete' }).count()).toBe(0)
    expect(await select.inputValue()).toBe('R')
  }, 20000)

  it('resets a cleared A assignment and restores it on cancel', async () => {
    await mountMatrix('A', 'cancel')
    const select = roleSelect()
    expect(await select.inputValue()).toBe('A')
    await select.selectOption('')
    expect(await select.inputValue()).toBe('A')
    await page.locator('button', { hasText: 'app.cancel' }).click()
    expect(await select.inputValue()).toBe('A')
  }, 20000)

  it('keeps the current role and shows an error when the mutation fails', async () => {
    await mountMatrix('R', 'fail')
    const select = roleSelect()
    await select.selectOption('A')
    expect(await select.inputValue()).toBe('R')
    await expect.poll(async () => page.locator('[role="alert"]').textContent()).toBe('errors.generic')
  }, 20000)

  it('keeps the current role while a mutation is pending, then shows the saved role', async () => {
    await mountMatrix('R', 'succeed')
    const select = roleSelect()
    await select.selectOption('C')
    expect(await select.inputValue()).toBe('R')
    await page.evaluate(() => (globalThis as { __releaseRaci?: () => void }).__releaseRaci?.())
    await expect.poll(async () => select.inputValue()).toBe('C')
  }, 20000)
})
