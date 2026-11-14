import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerCreatePanel, useCreatePanelOpen } from '../usePageHeader'

describe('create panel signal', () => {
  beforeEach(() => {
    const count = Vue.ref(0)
    vi.stubGlobal('useState', () => count)
  })

  it('is closed until a panel registers and closed again after it unregisters', () => {
    const open = useCreatePanelOpen()
    expect(open.value).toBe(false)
    const unregister = registerCreatePanel()
    expect(open.value).toBe(true)
    unregister()
    expect(open.value).toBe(false)
  })

  it('stays open while one of two overlapping panels remains', () => {
    const open = useCreatePanelOpen()
    const first = registerCreatePanel()
    const second = registerCreatePanel()
    first()
    expect(open.value).toBe(true)
    second()
    expect(open.value).toBe(false)
  })
})
