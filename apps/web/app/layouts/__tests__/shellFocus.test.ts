import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'

const layoutFile = resolve(import.meta.dirname, '../default.vue')
const layoutSource = readFileSync(layoutFile, 'utf8')

// No DOM environment here, so the layout's real <script setup> is compiled and
// driven directly: a stub element stands in for the template ref the browser
// would bind, and route changes are pushed through the actual watcher.
function loadLayout(route: { path: string }) {
  const descriptor = parse(layoutSource, { filename: layoutFile }).descriptor
  const compiled = compileScript(descriptor, { id: 'shell-focus', inlineTemplate: false }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/import\.meta\.client/g, 'true')
    .replace('export default', 'return')
  const js = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const bindings: Record<string, unknown> = {
    _defineComponent: Vue.defineComponent,
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
    onMounted: (fn: () => void) => fn(), onBeforeUnmount: () => undefined,
    useRoute: () => route,
    useI18n: () => ({ localeProperties: Vue.ref({ dir: 'rtl' }) }),
    useHead: () => undefined,
    isWorkspaceThemeRoute: () => true,
    hasNoContextSidebar: () => false,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined,
    setTimeout: () => 1, clearTimeout: () => undefined,
  }
  const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
  return component.setup!({}, { expose: () => {}, attrs: {}, slots: {}, emit: () => {} }) as Record<string, Vue.Ref> & { shellMain: Vue.Ref }
}

describe('shell focus after navigation', () => {
  it('moves focus to the main region on a route change, but not on first load', async () => {
    const focusCalls: unknown[] = []
    const route = Vue.reactive({ path: '/projects/7/tasks/99' })
    const state = loadLayout(route)

    // The browser binds this ref; stand in for it.
    state.shellMain.value = { focus: (options: unknown) => focusCalls.push(options) }

    await Vue.nextTick()
    expect(focusCalls, 'the first load must keep the browser default focus').toEqual([])

    // Escape on the record navigates back to the list.
    route.path = '/projects/7/tasks'
    await Vue.nextTick()
    await Vue.nextTick()
    expect(focusCalls, 'leaving a record must land focus on main, not <body>').toEqual([{ preventScroll: true }])
  })

  it('leaves focus alone when only the query changes on the same page', async () => {
    const focusCalls: unknown[] = []
    const route = Vue.reactive({ path: '/projects/7/tasks', fullPath: '/projects/7/tasks' })
    const state = loadLayout(route)
    state.shellMain.value = { focus: (options: unknown) => focusCalls.push(options) }

    // Typing in a filter must not have focus yanked out from under it.
    route.fullPath = '/projects/7/tasks?q=a'
    await Vue.nextTick()
    await Vue.nextTick()
    expect(focusCalls).toEqual([])
  })

})
