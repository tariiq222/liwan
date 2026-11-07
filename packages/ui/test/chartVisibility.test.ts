import * as Vue from 'vue'
import { expect, it, vi } from 'vitest'
import { useEventListener } from '@vueuse/core'
import { loadShared, DEFAULT_STUBS } from './helpers/renderShared'
import { createHostNode, hostRenderer } from './helpers/hostRenderer'

it('initializes only visible chart slots and retains them when scrolled away', async () => {
  const callbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
  let starts = 0
  const Chart = Vue.defineComponent({ setup() { starts++; return () => Vue.h('svg', { role: 'img' }) } })
  const Panel = loadShared('ChartPanel', {
    modules: {
      '@vueuse/core': {
        useIntersectionObserver: (_target: unknown, callback: (entries: Array<{ isIntersecting: boolean }>) => void) => { callbacks.push(callback); return { isSupported: Vue.ref(true), stop: () => {} } },
        useEventListener: () => {},
      },
    },
  })
  const app = hostRenderer.createApp({ render: () => Vue.h('main', Array.from({ length: 6 }, (_, index) => Vue.h(Panel, { title: `Chart ${index}`, defer: true }, () => Vue.h(Chart)))) })
  for (const [name, stub] of Object.entries(DEFAULT_STUBS)) app.component(name, stub)
  app.mount(createHostNode())
  expect(starts).toBe(0)
  callbacks[0]!([{ isIntersecting: true }]); callbacks[1]!([{ isIntersecting: true }])
  await Vue.nextTick()
  expect(starts).toBe(2)
  callbacks[0]!([{ isIntersecting: false }])
  await Vue.nextTick()
  expect(starts).toBe(2)
  for (const callback of callbacks.slice(2)) callback([{ isIntersecting: true }])
  await Vue.nextTick()
  expect(starts).toBe(6)
  app.unmount()
})

function printFixture(defer: boolean) {
  const target = new EventTarget()
  const add = vi.spyOn(target, 'addEventListener')
  const remove = vi.spyOn(target, 'removeEventListener')
  let starts = 0
  const Chart = Vue.defineComponent({ setup() { starts++; return () => Vue.h('svg', { role: 'img' }) } })
  const Panel = loadShared('ChartPanel', {
    modules: {
      '@vueuse/core': {
        // All six charts remain offscreen. Use the installed event lifecycle
        // implementation, with a real EventTarget in place of browser window.
        useIntersectionObserver: () => ({ isSupported: Vue.ref(true), stop: () => {} }),
        useEventListener: (event: string, listener: EventListener) => useEventListener(target, event, listener),
      },
    },
  })
  const app = hostRenderer.createApp({ render: () => Vue.h('main', Array.from({ length: 6 }, (_, index) => Vue.h(Panel, { title: `Print chart ${index}`, defer }, () => Vue.h(Chart)))) })
  for (const [name, stub] of Object.entries(DEFAULT_STUBS)) app.component(name, stub)
  app.mount(createHostNode())
  return { app, target, add, remove, starts: () => starts }
}

it('mounts all six offscreen chart slots on beforeprint and cleans up listeners on disposal', async () => {
  const view = printFixture(true)
  expect(view.starts()).toBe(0)
  expect(view.add).toHaveBeenCalledTimes(6)
  view.target.dispatchEvent(new Event('beforeprint'))
  await Vue.nextTick()
  expect(view.starts()).toBe(6)
  view.target.dispatchEvent(new Event('beforeprint'))
  await Vue.nextTick()
  expect(view.starts()).toBe(6)
  view.app.unmount()
  expect(view.remove).toHaveBeenCalledTimes(6)
  for (const [event, listener, options] of view.add.mock.calls) {
    expect(view.remove).toHaveBeenCalledWith(event, listener, options)
  }
  view.target.dispatchEvent(new Event('beforeprint'))
  await Vue.nextTick()
  expect(view.starts()).toBe(6)
})

it('keeps nondeferred charts eager without installing print listeners', async () => {
  const view = printFixture(false)
  expect(view.starts()).toBe(6)
  expect(view.add).not.toHaveBeenCalled()
  view.target.dispatchEvent(new Event('beforeprint'))
  await Vue.nextTick()
  expect(view.starts()).toBe(6)
  view.app.unmount()
  expect(view.remove).not.toHaveBeenCalled()
})
