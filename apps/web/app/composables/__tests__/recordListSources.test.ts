import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { useRecordListPaths } from '../useRecordListPaths'
import { MEETING_LIST_PATHS } from '../../modules/meetings/navigation'
import { owningListBack, recordChildTo, recordParentTo, recordSiblingTo } from '../../utils/recordListOrigin'
import { withManifests } from '../../modules/manifests'
import type { AppManifest } from '../../modules/types'

const origin = '/projects/2/meetings?offset=25&projectListReturnTo=%2Fprojects%3Fmine%3D1#row-2'
const identity = () => ({ capabilities: ['pmo.projects.read', 'meetings.read'], platform: { readable_features: ['pmo.enabled', 'meetings.enabled'], writable_features: [] } })
function sources(query: Record<string, unknown> = { returnTo: origin }) {
  const me = ref(identity())
  const route = reactive({ query })
  vi.stubGlobal('useMe', () => ({ me }))
  vi.stubGlobal('useRoute', () => route)
  return { paths: useRecordListPaths(MEETING_LIST_PATHS), me, route }
}
afterEach(() => vi.unstubAllGlobals())

describe('application-owned dynamic record list sources', () => {
  it('returns from a meeting record or create form to the project meeting list with its context', () => {
    const { paths } = sources()
    expect(paths.value[0]).toBe('/meetings')
    expect(paths.value).toContain('/projects/2/meetings')
    expect(owningListBack({ returnTo: origin }, paths.value)).toBe(origin)
  })

  it('retains the project source through editing, sibling forms and return to the meeting', () => {
    const { paths, route } = sources()
    expect(recordChildTo('/meetings/7/edit', { returnTo: origin }, paths.value))
      .toEqual({ path: '/meetings/7/edit', query: { listOrigin: origin } })
    route.query = { listOrigin: origin }
    expect(paths.value).toContain('/projects/2/meetings')
    expect(recordSiblingTo('/meetings/7/minutes', { listOrigin: origin }, paths.value))
      .toEqual({ path: '/meetings/7/minutes', query: { listOrigin: origin } })
    expect(recordParentTo('/meetings/7', { listOrigin: origin }, paths.value))
      .toEqual({ path: '/meetings/7', query: { returnTo: origin } })
  })

  it('updates recognized sources when the route changes', () => {
    const { paths, route } = sources()
    route.query = { returnTo: '/projects/9/meetings?offset=50' }
    expect(paths.value).toContain('/projects/9/meetings')
    expect(paths.value).not.toContain('/projects/2/meetings')
  })

  it.each(['pmo.enabled', 'meetings.enabled'])('withdraws the source when %s becomes unreadable', feature => {
    const { paths, me } = sources()
    expect(paths.value).toContain('/projects/2/meetings')
    me.value.platform.readable_features = me.value.platform.readable_features.filter(key => key !== feature)
    expect(paths.value).not.toContain('/projects/2/meetings')
  })

  it.each(['pmo.projects.read', 'meetings.read'])('requires %s in addition to both application features', capability => {
    const { paths, me } = sources()
    me.value.capabilities = me.value.capabilities.filter(key => key !== capability)
    expect(paths.value).not.toContain('/projects/2/meetings')
  })

  it.each([
    ['//outside.test/projects/2/meetings'], ['https://outside.test/projects/2/meetings'],
    [['/projects/2/meetings']], ['/projects/0/meetings'], ['/projects/02/meetings'], ['/projects/-2/meetings'],
    ['/projects/2.1/meetings'], ['/projects/2e1/meetings'], ['/projects/new/meetings'], ['/projects/2/meetings/new'],
    ['/projects/2/meetings/7'], ['/projects/2/meetings/'], ['/projects/2/tasks'], ['/projects/2'],
    ['/projects/2/meetings\\evil'], ['/projects/2/meetings\n'],
  ])('rejects unsafe or undeclared source %j', value => {
    const { paths } = sources({ returnTo: value, listOrigin: value })
    expect(paths.value.filter(path => /^\/projects\/\d+\//.test(path))).toEqual([])
  })

  it('does not let another application register a source it does not own', () => {
    const foreign: AppManifest = {
      id: 'crm', feature: 'crm.enabled', routePrefixes: ['/crm'], rail: [], nav: [],
      recordListSources: [{ pattern: /^\/projects\/2\/meetings$/, capability: 'meetings.read' }],
    }
    withManifests([foreign], () => {
      expect(sources().paths.value).not.toContain('/projects/2/meetings')
    })
  })

  it.each(['/meetings?q=site#row-7', '/meetings/calendar?month=10&year=2026#day-15'])('preserves the ordinary meeting source %s', source => {
    const { paths } = sources({ returnTo: source })
    expect(owningListBack({ returnTo: source }, paths.value)).toBe(source)
  })
})
