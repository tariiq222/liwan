import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import { createHostNode, hostRenderer } from '../../../test/helpers/hostRenderer'
import { provideSettingsSave, type SettingsSaveEntry, type SettingsSaveRegistry } from '../useSettingsSave'

const entry = (id: string, patch: Partial<SettingsSaveEntry> = {}): SettingsSaveEntry => reactive({
  id, dirty: false, saving: false, conflict: false, failed: false, submit: vi.fn(), revert: vi.fn(), ...patch,
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

  it('saveAll submits only the dirty cards, leaving out a conflicted or already saving one', () => {
    const registry = withRegistry()
    const clean = entry('clean')
    const dirty = entry('dirty', { dirty: true })
    const conflicted = entry('conflicted', { dirty: true, conflict: true })
    const saving = entry('saving', { dirty: true, saving: true })
    for (const candidate of [clean, dirty, conflicted, saving]) registry.register(candidate)

    registry.saveAll()

    expect(dirty.submit).toHaveBeenCalledTimes(1)
    expect(clean.submit).not.toHaveBeenCalled()
    expect(conflicted.submit).not.toHaveBeenCalled()
    expect(saving.submit).not.toHaveBeenCalled()
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
