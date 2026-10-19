import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { describe, expect, it } from 'vitest'
import { projectIdFromPath } from '../../modules/pmo/projectRoutes'

// A section page mounts even for an id its route can never resolve: <NuxtPage />
// is unconditional and useProject is merely disabled, so each page decides for
// itself what to show. Those decisions are evaluated here from the real
// <script setup>, against a real router.
const webRoot = resolve(import.meta.dirname, '../../../')

const MILESTONES = 'app/pages/projects/[id]/milestones.vue'
const TASKS = 'app/pages/projects/[id]/tasks.vue'

class TestApiError extends Error {
  status: number
  constructor(status: number) {
    super(`http ${status}`)
    this.status = status
  }
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/projects', component: { template: '<div/>' } },
      { path: '/projects/:id/milestones', component: { template: '<div/>' } },
      { path: '/projects/:id/tasks', component: { template: '<div/>' } },
      { path: '/:rest(.*)', component: { template: '<div/>' } },
    ],
  })
}

type ProjectState = { active?: boolean; can_manage?: boolean; stages?: unknown[] } | undefined

function loadSetupState(rel: string, router: Router, project: ProjectState, error: unknown, can: boolean) {
  const file = resolve(webRoot, rel)
  const descriptor = parse(readFileSync(file, 'utf8'), { filename: file }).descriptor
  const compiled = compileScript(descriptor, { id: 'section-guards', inlineTemplate: false }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const js = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const bindings: Record<string, unknown> = {
    _defineComponent: Vue.defineComponent, defineComponent: Vue.defineComponent,
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, h: Vue.h,
    onMounted: () => undefined, onBeforeUnmount: () => undefined,
    useRoute: () => router.currentRoute.value, useRouter: () => router,
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: () => can }),
    usePageHeader: () => undefined,
    useTaskFilters: () => Vue.ref({}),
    // Real helpers: these decide the id the guards are built from.
    projectIdFromPath,
    safeReturnTo: (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback),
    ApiError: TestApiError,
    useProject: () => ({
      data: Vue.ref(project), isLoading: Vue.ref(false), error: Vue.ref(error), refetch: () => undefined,
    }),
  }
  // Child components and unrelated composables were stripped with the imports
  // but are still named in the compiled output; none of them feeds a guard.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
      return component.setup!({}, { expose: () => {}, attrs: {}, slots: {}, emit: () => {} }) as Record<string, Vue.Ref>
    }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      const undefinedName = cause instanceof ReferenceError ? /(\w+) is not defined/.exec(message)?.[1] : undefined
      if (undefinedName && !(undefinedName in bindings)) { bindings[undefinedName] = {}; continue }
      const notCallable = cause instanceof TypeError ? /(\w+) is not a function/.exec(message)?.[1] : undefined
      if (notCallable && typeof bindings[notCallable] !== 'function') { bindings[notCallable] = () => ({}); continue }
      throw cause
    }
  }
  throw new Error(`${rel}: too many undefined bindings`)
}

// A guard that stopped being exposed should fail as a missing guard, not as a
// type error, so every read goes through here.
function guard<T>(state: Record<string, Vue.Ref>, name: string): T {
  const found = state[name]
  if (!found) throw new Error(`the page no longer exposes ${name}`)
  return found.value as T
}

async function stateAt(url: string, page: string, options: {
  project?: ProjectState
  error?: unknown
  can?: boolean
} = {}) {
  const router = makeRouter()
  await router.push(url)
  await router.isReady()
  return loadSetupState(page, router, options.project, options.error ?? null, options.can ?? true)
}

const ACTIVE = { active: true, can_manage: true, stages: [] }

describe.each([
  ['milestones', MILESTONES, '/projects/7/milestones', '/projects/abc/milestones'],
  ['tasks', TASKS, '/projects/7/tasks', '/projects/abc/tasks'],
])('%s section escapes an id it cannot use', (_name, page, valid, invalid) => {
  it('reports not found for an unusable project id, before any request', async () => {
    const state = await stateAt(invalid, page, { project: undefined })
    expect(guard<boolean>(state, 'notFound')).toBe(true)
  })

  it('reports not found for a denied or missing project', async () => {
    for (const status of [403, 404]) {
      const state = await stateAt(valid, page, { project: undefined, error: new TestApiError(status) })
      expect(guard<boolean>(state, 'notFound'), String(status)).toBe(true)
    }
  })

  it('keeps a transient failure retryable instead of calling the project missing', async () => {
    // A 500 has no verdict about the project; the page must offer a retry, and
    // saying "not found" here would send the visitor back to the list.
    const state = await stateAt(valid, page, { project: undefined, error: new TestApiError(500) })
    expect(guard<boolean>(state, 'notFound')).toBe(false)
  })

  it('shows the section for a readable project', async () => {
    const state = await stateAt(valid, page, { project: ACTIVE })
    expect(guard<boolean>(state, 'notFound')).toBe(false)
  })
})

describe('section create actions follow their own rule', () => {
  it('offers a milestone only to a manager of an active project', async () => {
    const manager = await stateAt('/projects/7/milestones', MILESTONES, { project: ACTIVE })
    expect(guard<boolean>(manager, 'canCreate')).toBe(true)
    const reader = await stateAt('/projects/7/milestones', MILESTONES, { project: { active: true, can_manage: false } })
    expect(guard<boolean>(reader, 'canCreate')).toBe(false)
    const archived = await stateAt('/projects/7/milestones', MILESTONES, { project: { active: false, can_manage: true } })
    expect(guard<boolean>(archived, 'canCreate')).toBe(false)
  })

  it('offers a task on the capability rather than on project ownership', async () => {
    // This is the one section where a capability, not can_manage, decides
    // creation; widening it to ownership would be a security regression.
    const capable = await stateAt('/projects/7/tasks', TASKS, { project: { active: true, can_manage: false }, can: true })
    expect(guard<boolean>(capable, 'canCreate')).toBe(true)
    const owner = await stateAt('/projects/7/tasks', TASKS, { project: ACTIVE, can: false })
    expect(guard<boolean>(owner, 'canCreate')).toBe(false)
    const archived = await stateAt('/projects/7/tasks', TASKS, { project: { active: false, can_manage: true }, can: true })
    expect(guard<boolean>(archived, 'canCreate')).toBe(false)
  })
})

describe('the task section presentation comes from the URL', () => {
  it('picks the board only on view=board, and gives it the project stages', async () => {
    const table = await stateAt('/projects/7/tasks', TASKS, { project: ACTIVE })
    expect(guard<boolean>(table, 'isBoard')).toBe(false)
    const board = await stateAt('/projects/7/tasks?view=board', TASKS, { project: ACTIVE })
    expect(guard<boolean>(board, 'isBoard')).toBe(true)
    // TaskBoard falls back to personal stages when stageSource is omitted, so
    // the project kind is what keeps a project board off personal columns.
    expect(guard<{ kind: string }>(board, 'stageSource')).toMatchObject({ kind: 'project' })
  })
})
