import { resolve } from 'node:path'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { loadShared, renderShared } from '@webvue/ui/test/helpers/renderShared'
import * as projectNavigation from '../../../../modules/pmo/projectSections'
import * as governanceNavigation from '../../../../modules/pmo/governanceSections'
import * as activeRoute from '../../../../modules/pmo/projectRoutes'
import * as workspaceMemory from '../../../../utils/projectWorkspaceMemory'
import * as sectionTabs from '@webvue/ui/app/utils/sectionTabs'

async function links(path: string, level = 'sections') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: {} }] })
  await router.push(path)
  const html = await renderShared(resolve(import.meta.dirname, '../workspace/ProjectWorkspaceTabs.vue'), { projectId: 7, active: true, level }, {}, {
    globals: {
      useRoute: () => router.currentRoute.value,
      useMe: () => ({ me: ref({ capabilities: ['pmo.projects.read', 'pmo.tasks.read', 'meetings.read'] }) }),
    },
    modules: {
      '@/modules/pmo/projectSections': projectNavigation,
      '@/modules/pmo/governanceSections': governanceNavigation,
      '@/modules/pmo/projectRoutes': activeRoute,
      '@/composables/useProjects': { useProject: () => ({ data: ref({ active: true }) }) },
      '@/utils/projectWorkspaceMemory': workspaceMemory,
    },
    stubs: {
      SharedRouteTabs: loadShared('RouteTabs', { modules: { '../../../utils/sectionTabs': sectionTabs } }),
      UButton: defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
        return () => h('a', { 'data-testid': attrs['data-testid'], href: router.resolve(attrs.to as any).href }, slots.default?.())
      } }),
    },
  })
  return Object.fromEntries<string>([...html.matchAll(/<a data-testid="([^"]+)" href="([^"]+)"/g)].map(([, id, href]): [string, string] => [id!, href!.replaceAll('&amp;', '&')]))
}

describe('project section navigation context', () => {
  it('carries task filters from a trailing-slash task section', async () => {
    const hrefs = await links('/projects/7/tasks/?view=board&q=review')
    const url = new URL(hrefs['project-tab-summary']!, 'http://webvue.local')
    expect(JSON.parse(url.searchParams.get('taskContext') ?? '{}')).toEqual({ view: 'board', q: 'review' })
  })
  it('carries the task board filters and list origin when leaving for summary', async () => {
    const hrefs = await links('/projects/7/tasks?view=board&q=review&state=in_progress&returnTo=%2Fprojects%3Fmine%3D1&projectListReturnTo=%2Fprojects%3Fmine%3D1')
    const url = new URL(hrefs['project-tab-summary']!, 'http://webvue.local')
    expect(url.searchParams.get('returnTo')).toBe('/projects?mine=1')
    expect(url.searchParams.get('projectListReturnTo')).toBe('/projects?mine=1')
    expect(JSON.parse(url.searchParams.get('taskContext') ?? '{}')).toEqual({ view: 'board', q: 'review', state: 'in_progress' })
  })
  it('restores task filters from summary without nesting return targets', async () => {
    const context = encodeURIComponent(JSON.stringify({ view: 'board', q: 'review', closed: '1', returnTo: '/evil' }))
    const hrefs = await links(`/projects/7?taskContext=${context}&returnTo=%2Fprojects%3Fmine%3D1&projectListReturnTo=%2Fprojects%3Fmine%3D1`)
    expect(hrefs['project-tab-tasks'], JSON.stringify(hrefs)).toBeDefined()
    const url = new URL(hrefs['project-tab-tasks']!, 'http://webvue.local')
    expect(Object.fromEntries(url.searchParams)).toEqual({ view: 'board', q: 'review', closed: '1', returnTo: '/projects?mine=1', projectListReturnTo: '/projects?mine=1' })
  })
  it('keeps list origin and task context across governance subsections', async () => {
    const context = encodeURIComponent(JSON.stringify({ view: 'board', q: 'review' }))
    const hrefs = await links(`/projects/7/charter?taskContext=${context}&projectListReturnTo=%2Fprojects%3Fmine%3D1`, 'governance')
    for (const href of Object.values(hrefs)) {
      const url = new URL(href, 'http://webvue.local')
      expect(url.searchParams.get('projectListReturnTo')).toBe('/projects?mine=1')
      expect(JSON.parse(url.searchParams.get('taskContext') ?? '{}')).toEqual({ view: 'board', q: 'review' })
    }
    expect(Object.keys(hrefs)).toHaveLength(4)
  })
})
