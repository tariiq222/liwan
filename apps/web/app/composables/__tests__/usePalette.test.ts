import { describe, expect, it } from 'vitest'
import { paletteNavigationBlocked, shouldRestoreTriggerFocus } from '../usePalette'
import { createMemoryHistory, createRouter, type NavigationFailure } from 'vue-router'

describe('shouldRestoreTriggerFocus', () => {
  it('restores focus when the selection stays on the same page', () => {
    expect(shouldRestoreTriggerFocus('/tasks', '/tasks')).toBe(true)
  })

  it('leaves focus to the layout when the selection goes to another internal page', () => {
    expect(shouldRestoreTriggerFocus('/projects', '/tasks')).toBe(false)
  })

  it('restores focus when nothing was selected or the target is external', () => {
    expect(shouldRestoreTriggerFocus(null, '/tasks')).toBe(true)
  })
})

describe('paletteNavigationBlocked', () => {
  const component = { render: () => null }
  async function router(block: boolean) {
    const instance = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/a', component }, { path: '/b', component, beforeEnter: () => !block }],
    })
    await instance.push('/a')
    return instance
  }

  it('is true when a guard blocks the navigation, and afterEach receives that failure', async () => {
    const instance = await router(true)
    let seen: NavigationFailure | void = undefined
    instance.afterEach((_to, _from, failure) => { seen = failure })
    const result = await instance.push('/b')
    expect(paletteNavigationBlocked(result)).toBe(true)
    expect(paletteNavigationBlocked(seen)).toBe(true)
  })

  it('is false for a completed navigation and for a repeat of the current page', async () => {
    const instance = await router(false)
    expect(paletteNavigationBlocked(await instance.push('/b'))).toBe(false)
    expect(paletteNavigationBlocked(await instance.push('/b'))).toBe(false)
    expect(paletteNavigationBlocked(undefined)).toBe(false)
  })
})
