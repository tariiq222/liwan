import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import { createHostNode, hostRenderer } from '../../../test/helpers/hostRenderer'
import { focusFirstInvalidControl, provideSettingsSave, type SettingsSaveEntry, type SettingsSaveRegistry } from '../useSettingsSave'

const entry = (id: string, patch: Partial<SettingsSaveEntry> = {}): SettingsSaveEntry => reactive({
  id, dirty: false, saving: false, conflict: false, failed: false, submit: vi.fn(async () => undefined), revert: vi.fn(), ...patch,
})

/** `provide` needs a component instance, so the registry is provided from a throwaway root. */
function withRegistry(): SettingsSaveRegistry {
  let registry: SettingsSaveRegistry | undefined
  const Root = defineComponent({
    setup() { registry = provideSettingsSave(); return () => h('i') },
  })
  const app = hostRenderer.createApp(Root)
  app.mount(createHostNode())
  if (!registry) throw new Error('the root did not provide a settings save registry')
  return registry
}

describe('useSettingsSaveRegistry', () => {
  it('is a no-op when nothing is registered', () => {
    const registry = withRegistry()
    expect(registry.pending.value).toBe(0)
    expect(registry.saving.value).toBe(false)
    expect(registry.failed.value).toBe(false)
    expect(() => { registry.saveAll(); registry.revertAll() }).not.toThrow()
  })

  it('counts the dirty cards, reports saving and failure, and forgets an unregistered card', () => {
    const registry = withRegistry()
    const clean = entry('clean')
    const dirty = entry('dirty', { dirty: true })
    const failing = entry('failing', { dirty: true, failed: true, saving: true })
    const unregisterClean = registry.register(clean)
    registry.register(dirty)
    registry.register(failing)

    expect(registry.pending.value).toBe(2)
    expect(registry.saving.value).toBe(true)
    expect(registry.failed.value).toBe(true)

    unregisterClean()
    dirty.dirty = false
    failing.dirty = false
    failing.failed = false
    failing.saving = false
    expect(registry.pending.value).toBe(0)
    expect(registry.saving.value).toBe(false)
    expect(registry.failed.value).toBe(false)
  })

  it('saveAll submits only the dirty cards, leaving out a conflicted or already saving one', async () => {
    const registry = withRegistry()
    const clean = entry('clean')
    const dirty = entry('dirty', { dirty: true })
    const conflicted = entry('conflicted', { dirty: true, conflict: true })
    const saving = entry('saving', { dirty: true, saving: true })
    for (const candidate of [clean, dirty, conflicted, saving]) registry.register(candidate)

    await registry.saveAll()

    expect(dirty.submit).toHaveBeenCalledTimes(1)
    expect(clean.submit).not.toHaveBeenCalled()
    expect(conflicted.submit).not.toHaveBeenCalled()
    expect(saving.submit).not.toHaveBeenCalled()
  })

  it('saveAll saves the cards one after another, so each reads the revision the previous save stored', async () => {
    const registry = withRegistry()
    let finishFirst: () => void = () => undefined
    const first = entry('first', { dirty: true, submit: vi.fn(() => new Promise<void>((done) => { finishFirst = done })) })
    const second = entry('second', { dirty: true, submit: vi.fn(async () => undefined) })
    registry.register(first)
    registry.register(second)

    const all = registry.saveAll()
    expect(first.submit).toHaveBeenCalledTimes(1)
    expect(second.submit).not.toHaveBeenCalled()
    expect(registry.saving.value).toBe(true)

    finishFirst()
    await all
    expect(second.submit).toHaveBeenCalledTimes(1)
    expect(registry.saving.value).toBe(false)
  })

  it('revertAll reverts every dirty card and nothing else', () => {
    const registry = withRegistry()
    const clean = entry('clean')
    const first = entry('first', { dirty: true })
    const second = entry('second', { dirty: true, conflict: true })
    for (const candidate of [clean, first, second]) registry.register(candidate)

    registry.revertAll()

    expect(first.revert).toHaveBeenCalledTimes(1)
    expect(second.revert).toHaveBeenCalledTimes(1)
    expect(clean.revert).not.toHaveBeenCalled()
  })

  it('keeps one entry per card id and unregisters only the registration that is current', () => {
    const registry = withRegistry()
    const first = entry('profile', { dirty: true })
    const second = entry('profile', { dirty: true })
    const unregisterFirst = registry.register(first)
    const unregisterSecond = registry.register(second)

    expect(registry.pending.value).toBe(1)
    unregisterFirst()
    expect(registry.pending.value).toBe(1)
    unregisterSecond()
    expect(registry.pending.value).toBe(0)
  })
})

describe('focusFirstInvalidControl', () => {
  it('focuses the first invalid control without scrolling to it, then centres it instantly', () => {
    const control = { focus: vi.fn(), scrollIntoView: vi.fn() }
    const root = { querySelector: vi.fn(() => control) }
    expect(focusFirstInvalidControl(root as never)).toBe(true)
    expect(root.querySelector).toHaveBeenCalledWith('[aria-invalid="true"]')
    expect(control.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(control.scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('does nothing when no control is invalid', () => {
    expect(focusFirstInvalidControl({ querySelector: () => null } as never)).toBe(false)
    expect(focusFirstInvalidControl(null)).toBe(false)
  })
})

describe('saveAll focus', () => {
  it('asks only the first card that focuses an invalid control to do so', async () => {
    const registry = withRegistry()
    const calls: Array<boolean | undefined> = []
    const failing = (id: string, focuses: boolean) => entry(id, {
      dirty: true,
      failed: true,
      submit: vi.fn(async (options?: { focus?: boolean }) => { calls.push(options?.focus); return focuses && options?.focus !== false }),
    })
    registry.register(failing('a', false))
    registry.register(failing('b', true))
    registry.register(failing('c', true))
    await registry.saveAll()
    // `a` has no invalid control and is asked; `b` focuses; `c` is told not to.
    expect(calls).toEqual([true, true, false])
  })
})
