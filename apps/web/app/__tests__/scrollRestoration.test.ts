import { createMemoryHistory, createRouter, type RouteLocationNormalizedGeneric, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import routerOptions from '../router.options'
import { recallScrollPosition } from '../utils/scrollMemory'

const globals = globalThis as Record<string, unknown>

interface Viewport { scrollY: number, innerHeight: number, scrollHeight: number }

let router: Router
let viewport: Viewport
let frames: (() => void)[]

// The restore waits on animation frames, so pumping alternates letting the
// queued work be scheduled with running the frames it asked for.
async function pumpFrames(rounds = 80) {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    for (const frame of frames.splice(0)) frame()
  }
}

function stubBrowser() {
  viewport = { scrollY: 0, innerHeight: 800, scrollHeight: 800 }
  frames = []
  globals.window = { get scrollY() { return viewport.scrollY }, get innerHeight() { return viewport.innerHeight } }
  globals.document = Object.assign(new EventTarget(), { documentElement: { get scrollHeight() { return viewport.scrollHeight } }, querySelector: () => null })
  globals.requestAnimationFrame = (callback: () => void) => { frames.push(callback); return frames.length }
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

// router.resolve returns a resolved location, whose `name` is nullable;
// scrollBehavior is typed for the normalized location vue-router hands it.
function resolved(path: string) {
  return router.resolve(path) as unknown as RouteLocationNormalizedGeneric
}

/** Drive the real scrollBehavior the way vue-router drives it on a push. */
async function restore(toPath: string) {
  const behavior = routerOptions.scrollBehavior!
  // savedPosition is null for a push: it is populated for popstate only.
  const result = behavior(resolved(toPath), router.currentRoute.value, null)
  return result
}

beforeEach(async () => {
  stubBrowser()
  router = makeRouter()
  await installRecorder()
})

afterEach(() => {
  for (const key of ['window', 'document', 'requestAnimationFrame', 'useRouter', 'defineNuxtPlugin']) delete globals[key]
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
    await pumpFrames()
    expect(await fresh).toEqual({ left: 0, top: 0, behavior: 'instant' })

    await router.push('/projects/7/tasks?view=board')
    // A filter keystroke changes the query on the same path: nothing to restore.
    expect(await routerOptions.scrollBehavior!(resolved('/projects/7/tasks?view=board&q=a'), router.currentRoute.value, null)).toBe(false)
  })

  it('prefers a browser back/forward savedPosition over the remembered one', async () => {
    await router.push('/projects/7/tasks?view=board')
    await router.isReady()
    viewport.scrollY = 640
    await router.push('/projects/7/tasks/99?view=board')
    viewport.scrollHeight = 4000

    const behavior = routerOptions.scrollBehavior!
    const pending = behavior(resolved('/projects/7/tasks?view=board'), router.currentRoute.value, { left: 0, top: 120 })
    await pumpFrames()
    expect(await pending).toEqual({ left: 0, top: 120, behavior: 'instant' })
  })

  // The restore used to be wrapped in hookOnce('page:finish'). vue-router calls
  // scrollBehavior after the navigation is confirmed, and for a page whose data
  // is already cached Nuxt has fired page:finish before that — so the listener
  // never ran and the page never moved. Nothing here provides useNuxtApp: the
  // restore must reach the offset on measurement alone.
  it('restores without waiting on a Nuxt lifecycle hook', async () => {
    await router.push('/projects/7/tasks')
    await router.isReady()
    viewport.scrollY = 640
    await router.push('/projects/7/tasks/99')
    viewport.scrollY = 0
    viewport.scrollHeight = 4000

    const pending = restore('/projects/7/tasks')
    await pumpFrames()

    expect(await pending).toEqual({ left: 0, top: 640, behavior: 'instant' })
  })

  it('still lands on the offset when a cold list takes hundreds of frames to arrive', async () => {
    await router.push('/projects/7/tasks')
    await router.isReady()
    viewport.scrollY = 640
    await router.push('/projects/7/tasks/99')
    viewport.scrollY = 0
    viewport.scrollHeight = 800

    let settled: unknown
    const pending = restore('/projects/7/tasks').then((value) => { settled = value; return value })
    // Far past the frame budget the old wait allowed a slow request.
    await pumpFrames(200)
    expect(settled, 'a slow list must not make the restore give up at the top').toBeUndefined()

    viewport.scrollHeight = 4000
    await pumpFrames()
    expect(await pending).toEqual({ left: 0, top: 640, behavior: 'instant' })
  })

  it('leaves the page alone if the reader scrolled while the cold list was loading', async () => {
    await router.push('/projects/7/tasks')
    await router.isReady()
    viewport.scrollY = 640
    await router.push('/projects/7/tasks/99')
    viewport.scrollY = 0
    viewport.scrollHeight = 800

    const pending = restore('/projects/7/tasks')
    await pumpFrames(10)
    // The reader started reading from the top rather than wait.
    viewport.scrollY = 300
    viewport.scrollHeight = 4000
    await pumpFrames()

    expect(await pending, 'a late restore over a reader is a yank, not a restore').toBe(false)
  })
})
