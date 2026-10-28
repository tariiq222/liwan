import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { CrmSettings } from '@webvue/contracts'
import { ApiError } from '../../useApi'

// The shared settings query and the server stand-in: a save carries a revision and the server answers 409 when it is not its own.
const settings = ref<CrmSettings>(undefined as never)
let serverRevision = 0
const stale = () => new ApiError(409, 'conflict', 'CRM settings changed; reload before saving')
const save = vi.fn(async (body: { revision: number; values?: Record<string, unknown> }) => {
  if (body.revision !== serverRevision) throw stale()
  serverRevision += 1
  settings.value = { ...settings.value, revision: serverRevision, values: { ...settings.value.values, ...body.values } }
  return settings.value
})
vi.mock('../useCrmSettings', () => ({ useSaveCrmSettings: () => ({ mutateAsync: save }) }))

const { useCrmSettingsCard } = await import('../useCrmSettingsCard')

const seed = (): CrmSettings => ({
  revision: 0,
  values: { visibility: 'own', view_log_enabled: false, discount_allowed: false, discount_max_percent: 0 } as CrmSettings['values'],
  options: {} as CrmSettings['options'],
  distribution_users: [],
})
const privacy = (reload = async () => settings.value) => useCrmSettingsCard({
  settings: () => settings.value,
  read: ({ visibility, view_log_enabled }) => ({ visibility, view_log_enabled }),
  toPatch: values => ({ values }),
  reload,
})
const pricing = () => useCrmSettingsCard({
  settings: () => settings.value,
  read: ({ discount_allowed, discount_max_percent }) => ({ discount_allowed, discount_max_percent }),
  toPatch: values => ({ values }),
  reload: async () => settings.value,
})

beforeEach(() => {
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  settings.value = seed()
  serverRevision = 0
  save.mockClear()
})

describe('useCrmSettingsCard', () => {
  it('saves card A then card B in the same tab, and B keeps its draft while A saves', async () => {
    const a = privacy()
    const b = pricing()
    a.draft.value.visibility = 'all'
    b.draft.value.discount_allowed = true
    await a.save()
    expect(serverRevision).toBe(1)
    expect(b.draft.value.discount_allowed).toBe(true)
    expect(b.shell.value.dirty).toBe(true)
    await b.save()
    expect(b.shell.value.conflict).toBe(false)
    expect(save).toHaveBeenLastCalledWith({ revision: 1, values: { discount_allowed: true, discount_max_percent: 0 } })
    expect(serverRevision).toBe(2)
    expect(settings.value.values.visibility).toBe('all')
    expect(settings.value.values.discount_allowed).toBe(true)
  })

  it('answers a change made elsewhere with the conflict message and keeps the draft until reload', async () => {
    const a = privacy()
    a.draft.value.visibility = 'team'
    serverRevision = 5 // another session saved; the shared query was not refetched
    await a.save()
    expect(a.shell.value.conflict).toBe(true)
    expect(a.shell.value.message).toBe('crm.settings.conflict')
    expect(a.draft.value.visibility).toBe('team')
    save.mockClear()
    await a.save()
    expect(save).not.toHaveBeenCalled()
  })

  it('reloads the latest settings after a conflict and unlocks the card', async () => {
    const latest: CrmSettings = { ...seed(), revision: 5, values: { ...seed().values, visibility: 'all' } }
    const a = privacy(async () => latest)
    a.draft.value.visibility = 'team'
    serverRevision = 5
    await a.save()
    await a.reload()
    expect(a.shell.value.conflict).toBe(false)
    expect(a.draft.value.visibility).toBe('all')
  })
})
