import { afterEach, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mountScript } from './scriptHarness'

const frames: FrameRequestCallback[] = []
function fixture(reducedMotion = false) {
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  const items = ref<any[]>([])
  const view = mountScript(new URL('../InboxThread.vue', import.meta.url), {
    useMediaQuery: () => ref(reducedMotion),
    useInboxProviderError: () => ({ providerText: () => '' }),
    useInboxMessages: () => ({ items, isLoading: ref(false), isError: ref(false), error: ref(null), hasNextPage: ref(false), isFetchingNextPage: ref(false), fetchNextPage: vi.fn(), refetch: vi.fn() }),
    useRetryInboxMessage: () => ({ mutate: vi.fn(), isPending: ref(false), variables: ref(null) }),
    useReactToInboxMessage: () => ({ mutate: vi.fn() }), useRoute: () => ({ query: {} }),
  }, { conversationId: 1, canReply: true, windowOpen: true })
  return { ...view, items }
}
async function flushFrames() {
  for (let pass = 0; pass < 3; pass++) {
    frames.splice(0).forEach(callback => callback(performance.now()))
    await Promise.resolve()
  }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); frames.length = 0 })

it('reveals a quoted row before aligning it again after native offscreen layout settles', async () => {
  vi.useFakeTimers()
  const view = fixture()
  await nextTick()
  const target = { scrollIntoView: vi.fn() }
  const scroller = { querySelector: () => target, contains: () => true }
  view.state.scroller = scroller
  const operation = view.state.showQuoted(4000)
  expect(target.scrollIntoView).toHaveBeenNthCalledWith(1, { block: 'center', behavior: 'instant' })
  await flushFrames(); await operation
  expect(target.scrollIntoView).toHaveBeenNthCalledWith(2, { block: 'center', behavior: 'smooth' })
  expect(view.state.highlightedId).toBe(4000)
  vi.advanceTimersByTime(1600)
  expect(view.state.highlightedId).toBeNull()
  view.stop()
})

it('aligns the newest message again after estimated offscreen row heights resolve', async () => {
  const view = fixture()
  await nextTick()
  const scroller = { scrollHeight: 1000, scrollTo: vi.fn() }
  view.state.scroller = scroller
  view.items.value = [{ id: 3 }]
  await nextTick(); await nextTick()
  expect(scroller.scrollTo).toHaveBeenNthCalledWith(1, { top: 1000 })
  scroller.scrollHeight = 1210
  await flushFrames()
  expect(scroller.scrollTo).toHaveBeenNthCalledWith(2, { top: 1210 })
  view.stop()
})

it('does not animate quote alignment for reduced-motion users', async () => {
  vi.useFakeTimers()
  const view = fixture(true)
  await nextTick()
  const target = { scrollIntoView: vi.fn() }
  view.state.scroller = { querySelector: () => target, contains: () => true }
  const operation = view.state.showQuoted(4)
  await flushFrames(); await operation
  expect(target.scrollIntoView.mock.calls.map(call => call[0].behavior)).toEqual(['instant', 'instant'])
  view.stop()
})
it('does not align or highlight a previous conversation after an in-place route change', async () => {
  const view = fixture()
  await nextTick()
  const target = { scrollIntoView: vi.fn() }
  view.state.scroller = { querySelector: () => target, contains: () => true }
  const operation = view.state.showQuoted(4)
  view.props.conversationId = 2
  await flushFrames(); await operation
  expect(target.scrollIntoView).toHaveBeenCalledTimes(1)
  expect(view.state.highlightedId).toBeNull()
  view.stop()
})
it('settles pending layout work and clears the highlight timer on disposal', async () => {
  vi.useFakeTimers()
  const view = fixture()
  await nextTick()
  const target = { scrollIntoView: vi.fn() }
  view.state.scroller = { querySelector: () => target, contains: () => true }
  const operation = view.state.showQuoted(4)
  view.stop()
  await operation
  expect(target.scrollIntoView).toHaveBeenCalledTimes(1)
  expect(view.state.highlightedId).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})
it('does not complete newest-message alignment after a conversation change', async () => {
  const view = fixture()
  await nextTick()
  const scroller = { scrollHeight: 1000, scrollTo: vi.fn() }
  view.state.scroller = scroller
  view.items.value = [{ id: 3 }]
  await nextTick(); await nextTick()
  expect(scroller.scrollTo).toHaveBeenCalledTimes(1)
  view.props.conversationId = 2
  scroller.scrollHeight = 2000
  await flushFrames()
  expect(scroller.scrollTo).toHaveBeenCalledTimes(1)
  view.stop()
})
it('clears an active highlight timeout on disposal', async () => {
  vi.useFakeTimers()
  const view = fixture()
  await nextTick()
  const target = { scrollIntoView: vi.fn() }
  view.state.scroller = { querySelector: () => target, contains: () => true }
  const operation = view.state.showQuoted(4)
  await flushFrames(); await operation
  expect(vi.getTimerCount()).toBe(1)
  view.stop()
  expect(view.state.highlightedId).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})
