import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useProjectRecordListPaths } from '../useProjectRecordListPaths'

afterEach(() => vi.unstubAllGlobals())
describe('project record sources', () => {
  it('preserves the owning list first, includes readable matrix sources and withdraws unavailable applications', () => {
    const me = ref({ capabilities: ['pmo.projects.read', 'pmo.tasks.read', 'meetings.read'], platform: { readable_features: ['pmo.enabled', 'meetings.enabled'], writable_features: [] } })
    vi.stubGlobal('useMe', () => ({ me }))
    vi.stubGlobal('useRoute', () => ({ query: {} }))
    const paths = useProjectRecordListPaths(2, ['/projects/2/stakeholders'])
    expect(paths.value[0]).toBe('/projects/2/stakeholders')
    expect(paths.value).toContain('/projects/2/raci')
    expect(paths.value).toContain('/projects/2/meetings')
    me.value.platform.readable_features = ['pmo.enabled']
    expect(paths.value).not.toContain('/projects/2/meetings')
    me.value.platform.readable_features = []
    expect(paths.value).not.toContain('/projects/2/raci')
    expect(paths.value[0]).toBe('/')
  })
})
