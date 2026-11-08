import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'

/** A titled section of a settings page, listed in the page's in-page section navigation. */
export interface SettingsNavEntry { id: string; title: string }
interface SettingsNavRegistry { entries: Ref<SettingsNavEntry[]>; add: (entry: SettingsNavEntry) => void; remove: (id: string) => void }

const KEY: InjectionKey<SettingsNavRegistry> = Symbol('liwan-settings-nav')

/** The settings page provides the registry its sections add themselves to (in document order of mounting). */
export function provideSettingsNav(): Ref<SettingsNavEntry[]> {
  const entries = ref<SettingsNavEntry[]>([])
  provide(KEY, {
    entries,
    add: entry => { if (!entries.value.some(item => item.id === entry.id)) entries.value = [...entries.value, entry] },
    remove: id => { entries.value = entries.value.filter(item => item.id !== id) },
  })
  return entries
}

export function useSettingsNav(): SettingsNavRegistry | undefined {
  return inject(KEY, undefined)
}
