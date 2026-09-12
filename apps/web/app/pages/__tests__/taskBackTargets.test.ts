import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(import.meta.dirname, '../../../')
const read = (rel: string) => readFileSync(resolve(webRoot, rel), 'utf8')

describe('task detail back targets', () => {
  it('sends a project task back to its own task list, carrying the current filters', () => {
    // The parked defect: /projects/7/tasks/99?q=عقد used to fall back to
    // /projects/7?tab=tasks and drop q. The target is literal now.
    const page = read('app/pages/projects/[id]/tasks/[taskId].vue')
    expect(page).toContain('const backTo = computed(() => ({ path: `/projects/${projectId.value}/tasks`, query: route.query }))')
    expect(page).toContain(':back-to="backTo"')
    expect(page).not.toContain('closeTo')
    expect(page).not.toContain('safeReturnTo')
  })

  it('sends a standalone task back to /tasks, carrying the current filters', () => {
    const page = read('app/pages/tasks/[id].vue')
    expect(page).toContain("const backTo = computed(() => ({ path: '/tasks', query: route.query }))")
    expect(page).toContain(':back-to="backTo"')
    expect(page).not.toContain('closeTo')
    expect(page).not.toContain('safeReturnTo')
  })

  it('names the prop back-to on the page component itself', () => {
    const component = read('app/components/task/TaskDetailPage.vue')
    expect(component).toMatch(/backTo\?: RouteLocationRaw/)
    expect(component).not.toContain('closeTo')
  })
})

// Evaluate the page's real <script setup> against a real router so the direct
// link is proven at runtime, not read off the source.
function loadPage(rel: string, captured: Record<string, unknown>) {
  const file = resolve(webRoot, rel)
  const descriptor = parse(readFileSync(file, 'utf8'), { filename: file }).descriptor
  const compiled = compileScript(descriptor, { id: 'direct-link', inlineTemplate: false }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const js = ts.transpileModule(compiled, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const bindings: Record<string, unknown> = {
    _defineComponent: Vue.defineComponent,
    computed: Vue.computed, ref: Vue.ref, onMounted: () => undefined,
    useRoute: () => captured.route, useRouter: () => captured.router,
    useI18n: () => ({ t: (k: string) => k }),
    projectTaskParams: () => ({}), TaskDetailPage: {},
    defineComponent: Vue.defineComponent,
  }
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings))
}

describe('direct link to a project task with a filter', () => {
  it('returns to /projects/7/tasks carrying q, not the project summary', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/projects/:id/tasks/:taskId', component: { template: '<div/>' } },
        { path: '/projects/:id/tasks', component: { template: '<div/>' } },
        { path: '/projects/:id', component: { template: '<div/>' } },
      ],
    })
    await router.push('/projects/7/tasks/99?q=%D8%B9%D9%82%D8%AF')
    await router.isReady()
    const captured = { router, route: router.currentRoute.value }

    const page = loadPage('app/pages/projects/[id]/tasks/[taskId].vue', captured)
    const setupState = page.setup!({}, { expose: () => {}, attrs: {}, slots: {}, emit: () => {} }) as Record<string, Vue.Ref>

    const backTo = Vue.unref(setupState.backTo)
    expect(router.resolve(backTo).fullPath).toBe('/projects/7/tasks?q=%D8%B9%D9%82%D8%AF')
    expect(router.resolve(backTo).path).toBe('/projects/7/tasks')
    expect(router.resolve(backTo).query.q).toBe('عقد')
  })
})
