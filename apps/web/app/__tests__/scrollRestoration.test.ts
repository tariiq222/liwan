import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import routerOptions from '../router.options'
import { forgetScrollPositions, recallScrollPosition } from '../utils/scrollMemory'

const globals = globalThis as Record<string, unknown>

interface Viewport { scrollY: number, innerHeight: number, scrollHeight: number }

let router: Router
let viewport: Viewport
let frames: (() => void)[]
let pageFinish: (() => void | Promise<void>) | undefined

// The restore waits on timers and animation frames, so pumping alternates
// letting the queued work be scheduled with running the frames it asked for.
async function pumpFrames(rounds = 80) {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    for (const frame of frames.splice(0)) frame()
  }
}

function stubBrowser() {
  viewport = { scrollY: 0, innerHeight: 800, scrollHeight: 800 }
  frames = []
  pageFinish = undefined
  globals.window = { get scrollY() { return viewport.scrollY }, get innerHeight() { return viewport.innerHeight } }
  globals.document = { documentElement: { get scrollHeight() { return viewport.scrollHeight } }, querySelector: () => null }
  globals.requestAnimationFrame = (callback: () => void) => { frames.push(callback); return frames.length }
  globals.useNuxtApp = () => ({ hooks: { hookOnce: (_name: string, handler: () => void) => { pageFinish = handler } } })
}

function makeRouter() {
  const page = { template: '<div/>' }
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/projects/:id/tasks', component: page },
      { path: '/projects/:id/tasks/:taskId', component: page },
      { path: '/tasks', component: page },
    ],
  })
}

// The plugin registers its recorder on the router; import it only once the
// Nuxt globals it reaches for exist.
async function installRecorder() {
  globals.defineNuxtPlugin = (setup: unknown) => setup
  globals.useRouter = () => router
  const plugin = (await import('../plugins/scrollMemory.client')).default as () => void
  plugin()
}

/** Drive the real scrollBehavior the way vue-router drives it on a push. */
async function restore(toPath: string) {
  const behavior = routerOptions.scrollBehavior!
  // savedPosition is null for a push: it is populated for popstate only.
  const result = behavior(router.resolve(toPath), router.currentRoute.value, null)
  return result
}

beforeEach(async () => {
  forgetScrollPositions()
  stubBrowser()
  router = makeRouter()
  await installRecorder()
})

afterEach(() => {
  for (const key of ['window', 'document', 'requestAnimationFrame', 'useNuxtApp', 'useRouter', 'defineNuxtPlugin']) delete globals[key]
})

describe('list scroll position survives a record visit', () => {
  it('records where the list was left when the record page is pushed', async () => {
    await router.push('/projects/7/tasks?view=board')
    await router.isReady()
    viewport.scrollY = 640

    await router.push('/projects/7/tasks/99?view=board')

    expect(recallScrollPosition('/projects/7/tasks?view=board')).toBe(640)
  })

  it('restores that offset on the push back, where savedPosition is null', async () => {
    await router.push('/projects/7/tasks?view=board')
    await router.isReady()
    viewport.scrollY = 640
    await router.push('/projects/7/tasks/99?view=board')
    viewport.scrollY = 0
    viewport.scrollHeight = 4000

    const pending = restore('/projects/7/tasks?view=board')
    void pageFinish!()
    await pumpFrames()

    expect(await pending).toEqual({ left: 0, top: 640, behavior: 'instant' })
  })

  it('waits for a vue-query list to fill before restoring, instead of clamping to the top', async () => {
    await router.push('/projects/7/tasks?view=board')
    await router.isReady()
    viewport.scrollY = 640
    await router.push('/projects/7/tasks/99?view=board')
    viewport.scrollY = 0
    // The list re-renders from an empty cache: the document is still one screen.
    viewport.scrollHeight = 800

    let settled: unknown
    const pending = restore('/projects/7/tasks?view=board').then((value) => { settled = value; return value })
    void pageFinish!()
    await pumpFrames(5)
    expect(settled, 'restoring into a short document would clamp to the top').toBeUndefined()

    viewport.scrollHeight = 4000
    await pumpFrames()
    expect(await pending).toEqual({ left: 0, top: 640, behavior: 'instant' })
  })

  it('sends an unvisited list to the top and leaves a same-page filter change alone', async () => {
    await router.push('/projects/7/tasks/99')
    await router.isReady()

    const fresh = restore('/tasks')
    void pageFinish!()
    await pumpFrames()
    expect(await fresh).toEqual({ left: 0, top: 0, behavior: 'instant' })

    await router.push('/projects/7/tasks?view=board')
    // A filter keystroke changes the query on the same path: nothing to restore.
    expect(routerOptions.scrollBehavior!(router.resolve('/projects/7/tasks?view=board&q=a'), router.currentRoute.value, null)).toBe(false)
  })

  it('prefers a browser back/forward savedPosition over the remembered one', async () => {
    await router.push('/projects/7/tasks?view=board')
    await router.isReady()
    viewport.scrollY = 640
    await router.push('/projects/7/tasks/99?view=board')
    viewport.scrollHeight = 4000

    const behavior = routerOptions.scrollBehavior!
    const pending = behavior(router.resolve('/projects/7/tasks?view=board'), router.currentRoute.value, { left: 0, top: 120 })
    void pageFinish!()
    await pumpFrames()
    expect(await pending).toEqual({ left: 0, top: 120, behavior: 'instant' })
  })
})
