import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { ApiError } from '../../useApi'

const { useSettingsForm } = await import('../useSettingsForm')

interface Source { revision: number; name: string; days: number }
const source = ref<Source>({ revision: 0, name: 'A', days: 3 })
const form = (save = vi.fn(async (draft: { name: string }, latest: Source) => ({ ...latest, ...draft, revision: latest.revision + 1 }))) => ({
  spy: save,
  ...useSettingsForm<Source, { name: string }>({
    source: () => source.value,
    read: ({ name }) => ({ name }),
    save,
    reload: async () => ({ revision: 9, name: 'Z', days: 3 }),
  }),
})

beforeEach(() => {
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  source.value = { revision: 0, name: 'A', days: 3 }
})

describe('useSettingsForm', () => {
  it('reverts the draft to the saved values and clears the dirty state', () => {
    const card = form()
    card.draft.value.name = 'B'
    expect(card.state.value.dirty).toBe(true)
    card.revert()
    expect(card.draft.value.name).toBe('A')
    expect(card.state.value.dirty).toBe(false)
  })

  it('saves with the latest settings the page knows and adopts the answer', async () => {
    const card = form()
    card.draft.value.name = 'B'
    source.value = { ...source.value, revision: 4, days: 5 }
    await card.save()
    expect(card.spy).toHaveBeenCalledWith({ name: 'B' }, { revision: 4, name: 'A', days: 5 })
    expect(card.state.value.dirty).toBe(false)
  })

  it('locks on a 409 with the generic conflict message until the current values are loaded', async () => {
    const card = form(vi.fn(async () => { throw new ApiError(409, 'conflict', 'changed') }))
    card.draft.value.name = 'B'
    await card.save()
    expect(card.state.value.conflict).toBe(true)
    expect(card.state.value.message).toBe('app.settingsConflict')
    card.revert()
    expect(card.state.value.conflict).toBe(true)
    await card.reload()
    expect(card.state.value.conflict).toBe(false)
    expect(card.draft.value.name).toBe('Z')
  })

  it('shows another 409 as a save error without locking the card', async () => {
    const card = form(vi.fn(async () => { throw new ApiError(409, 'last_access_admin', 'at least one access administrator is required') }))
    card.draft.value.name = 'B'
    await card.save()
    expect(card.state.value.conflict).toBe(false)
    expect(card.state.value.message).toBe('at least one access administrator is required')
  })

  it('follows a refetch that leaves its own fields alone, and keeps the draft', async () => {
    const card = form()
    card.draft.value.name = 'B'
    source.value = { revision: 2, name: 'A', days: 9 }
    await nextTick()
    expect(card.state.value.conflict).toBe(false)
    expect(card.draft.value.name).toBe('B')
    card.revert()
    expect(card.draft.value.name).toBe('A')
  })

  it('locks a dirty card when a refetch changed the fields it owns', async () => {
    const card = form()
    card.draft.value.name = 'B'
    source.value = { revision: 2, name: 'C', days: 3 }
    await nextTick()
    expect(card.state.value.conflict).toBe(true)
    expect(card.draft.value.name).toBe('B')
  })

  it('a clean card adopts the refetched values', async () => {
    const card = form()
    source.value = { revision: 2, name: 'C', days: 3 }
    await nextTick()
    expect(card.draft.value.name).toBe('C')
    expect(card.state.value.dirty).toBe(false)
  })
})
