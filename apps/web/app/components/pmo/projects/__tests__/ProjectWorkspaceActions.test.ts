import { resolve } from 'node:path'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as safeReturnTo from '@liwan/ui/app/utils/safeReturnTo'
import * as projectHeaderAction from '../../../../utils/projectHeaderAction'
import * as projectCopyAccess from '../../../../utils/projectCopyAccess'
import * as workspaceMemory from '../../../../utils/projectWorkspaceMemory'

interface State { path?: string; query?: Record<string, string>; caps?: string[]; active?: boolean; canManage?: boolean; canCreate?: boolean; kpis?: boolean }

// The dropdown stub lists the labels of every item, so the menu content can be read without opening it.
const DropdownStub = defineComponent({
  inheritAttrs: false,
  props: ['items'],
  setup: (props, { slots }) => () => h('div', { 'data-testid': 'menu-items' }, [
    ...(props.items as { label: string; to?: unknown }[][]).flat().map(item => h('i', { 'data-label': item.label }, item.label)),
    slots.default?.(),
  ]),
})

async function actions(state: State = {}) {
  const path = state.path ?? '/projects/7'
  const caps = state.caps ?? ['pmo.tasks.create', 'pmo.tasks.read', 'meetings.create']
  return renderShared(resolve(import.meta.dirname, '../workspace/ProjectWorkspaceActions.vue'), {
    project: { id: 7, name: 'Alpha', active: state.active ?? true, can_manage: state.canManage ?? true },
  }, {}, {
    globals: {
      useRoute: () => ({ path, fullPath: path, query: state.query ?? {} }),
      useRouter: () => ({ push: async () => undefined }),
      useListOpening: () => ref(false),
      useAccess: () => ({ can: (capability: string) => caps.includes(capability) }),
      useKpiVisibility: () => ({ shown: ref(state.kpis ?? true), toggle: () => {} }),
    },
    modules: {
      '@/composables/useProjectArchive': { useProjectArchive: () => ({ restore: async () => true, pending: ref(false) }) },
      '@/composables/useProjects': { useProjectList: () => ({ data: ref({ can_create: state.canCreate ?? true }) }) },
      '@/utils/projectCopyAccess': projectCopyAccess,
      '@/utils/projectHeaderAction': projectHeaderAction,
      '@/utils/projectWorkspaceMemory': workspaceMemory,
      '@liwan/ui/app/utils/safeReturnTo': safeReturnTo,
    },
    stubs: { UDropdownMenu: DropdownStub, UTooltip: defineComponent({ setup: (_, { slots }) => () => h('span', slots.default?.()) }) },
  })
}
const labels = (html: string) => [...html.matchAll(/data-label="([^"]+)"/g)].map(match => match[1])

describe('the project header actions', () => {
  it('offers a new task on the summary and on the task list, marked for the C shortcut', async () => {
    for (const path of ['/projects/7', '/projects/7/tasks']) {
      const html = await actions({ path })
      expect(html, path).toContain('data-testid="project-header-create"')
      expect(html).toContain('projects.workspace.newTask')
      expect(html).toContain('data-shortcut-create')
    }
  })
  it('offers a new meeting on the meetings tab, with the project in the form', async () => {
    const html = await actions({ path: '/projects/7/meetings' })
    expect(html).toContain('data-testid="project-meetings-create"')
    expect(html).toContain('meetingsUi.new')
    expect(html).not.toContain('project-header-create')
  })
  it('draws no primary action without the capability, on an archived project or over other pages', async () => {
    expect(await actions({ caps: [] })).not.toContain('project-header-create')
    expect(await actions({ path: '/projects/7/meetings', caps: ['meetings.read'] })).not.toContain('project-meetings-create')
    expect(await actions({ active: false })).not.toContain('project-header-create')
    for (const path of ['/projects/7/finance', '/projects/7/charter', '/projects/7/milestones', '/projects/7/tasks/3']) expect(await actions({ path }), path).not.toContain('data-shortcut-create')
  })
  it('puts settings, copy and archive in the menu, and the KPI toggle only on the task list', async () => {
    expect(labels(await actions())).toEqual(['nav.projectSettings', 'projects.copy.action', 'projects.menu.archive'])
    expect(labels(await actions({ path: '/projects/7/tasks' }))).toContain('app.hideKpis')
    expect(labels(await actions({ path: '/projects/7/tasks', kpis: false }))).toContain('app.showKpis')
  })
  it('offers restore, not archive, on an archived project and nothing to a reader without rights', async () => {
    expect(labels(await actions({ active: false }))).toContain('projects.menu.unarchive')
    const reader = await actions({ canManage: false, canCreate: false, caps: [] })
    expect(labels(reader)).toEqual([])
    expect(reader).not.toContain('project-workspace-menu')
  })
})
