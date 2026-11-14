import { refDebounced } from '@vueuse/core'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupSfc } from '../../../access/__tests__/sfcSetup'

const FILE = new URL('../PickList.vue', import.meta.url).pathname
const rows = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]

function pickList(props: Record<string, unknown> = {}) {
  const { state, emit } = setupSfc(FILE, { modelValue: null, items: rows, testId: 'x', searchLabel: '', listLabel: '', emptyText: '', ...props }, { refDebounced })
  return { state: Vue.proxyRefs(state), emit }
}

afterEach(() => vi.useRealTimers())

describe('PickList', () => {
  it('picks a row by its id and reports the row', () => {
    const { state, emit } = pickList()
    state.toggle(rows[1])
    expect(emit).toHaveBeenNthCalledWith(1, 'update:modelValue', 2)
    expect(emit).toHaveBeenNthCalledWith(2, 'resolve', rows[1])
  })

  it('drops the picked row when it is tapped again', () => {
    const { state, emit } = pickList({ modelValue: 2 })
    state.toggle(rows[1])
    expect(emit).toHaveBeenNthCalledWith(1, 'update:modelValue', null)
    expect(emit).toHaveBeenNthCalledWith(2, 'resolve', null)
  })

  it('reports the search term once typing pauses, not on every key', async () => {
    vi.useFakeTimers()
    const { state, emit } = pickList()
    state.q = 'ab'
    vi.advanceTimersByTime(100)
    state.q = 'abc'
    vi.advanceTimersByTime(200)
    expect(emit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    await Vue.nextTick()
    expect(emit).toHaveBeenCalledWith('update:search', 'abc')
  })

  it('shows loading first, then the error, then the empty state, else the list', () => {
    expect(pickList({ loading: true, error: new Error('x') }).state.view).toBe('loading')
    expect(pickList({ error: new Error('x') }).state.view).toBe('error')
    expect(pickList({ items: [] }).state.view).toBe('empty')
    expect(pickList().state.view).toBe('list')
  })

  it('tells a search with no hit from an empty service by the term', () => {
    const { state } = pickList({ items: [] })
    expect(state.searching).toBe(false)
    state.q = '  '
    expect(state.searching).toBe(false)
    state.q = 'x'
    expect(state.searching).toBe(true)
  })

  it('locks every row of a disabled picker', () => {
    expect(pickList({ disabled: true }).state.off).toBe(true)
    expect(pickList().state.off).toBe(false)
  })
})
