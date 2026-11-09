import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const archive = vi.fn()
const restore = vi.fn()
vi.mock('../useProjects', () => ({
  useArchiveProject: () => ({ mutateAsync: archive, isPending: ref(false) }),
  useUnarchiveProject: () => ({ mutateAsync: restore, isPending: ref(false) }),
}))
import { useProjectArchive } from '../useProjectArchive'

const toast = { add: vi.fn() }
function setup(hydrated = true) {
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  vi.stubGlobal('useHydrated', () => ref(hydrated))
  vi.stubGlobal('useToast', () => toast)
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('useProjectArchive', () => {
  it('archives a managed project, says so and reports success', async () => {
    setup()
    archive.mockResolvedValue({})
    expect(await useProjectArchive({ id: 7, can_manage: true }).archive()).toBe(true)
    expect(archive).toHaveBeenCalledWith({ id: 7 })
    expect(toast.add).toHaveBeenCalledWith({ title: 'projects.archived', color: 'success' })
  })
  it('restores with its own message', async () => {
    setup()
    restore.mockResolvedValue({})
    expect(await useProjectArchive(() => ({ id: 7, can_manage: true })).restore()).toBe(true)
    expect(toast.add).toHaveBeenCalledWith({ title: 'projects.unarchived', color: 'success' })
  })
  it('reports a failure with an error toast and no success', async () => {
    setup()
    archive.mockRejectedValue(new Error('offline'))
    expect(await useProjectArchive({ id: 7, can_manage: true }).archive()).toBe(false)
    expect(toast.add).toHaveBeenCalledWith({ title: 'errors.generic', color: 'error' })
  })
  it('does nothing without the manage right, before hydration or without a project', async () => {
    setup(false)
    expect(await useProjectArchive({ id: 7, can_manage: true }).archive()).toBe(false)
    setup()
    expect(await useProjectArchive({ id: 7, can_manage: false }).archive()).toBe(false)
    expect(await useProjectArchive(undefined).restore()).toBe(false)
    expect(archive).not.toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()
  })
})
