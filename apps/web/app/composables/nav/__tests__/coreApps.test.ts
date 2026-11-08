import { describe, expect, it } from 'vitest'
import { coreAppItems } from '../coreApps'
import { railModel } from '../sidebarModel'
import { pinnedApplications } from '../railPins'
import { visibleShellModules } from '../shellModules'
import { withManifests } from '../../../modules/manifests'
import type { AppManifest } from '../../../modules/types'

const manifest = (id: string, core?: number, order = 10): AppManifest => ({
  id, feature: `${id}.enabled`, routePrefixes: [`/${id}`],
  rail: [{ id, labelKey: `nav.${id}`, icon: `i-lucide-${id}`, to: `/${id}`, order, ...(core ? { core } : {}) }],
  nav: [{ to: `/${id}`, labelKey: `nav.${id}`, icon: 'i-lucide-circle', shortcut: '', capability: `${id}.read` }],
})
// Declared out of order on purpose: the row follows `core`, not the manifest `order` or the declaration order.
const manifests = [manifest('documents', 5, 70), manifest('projects', undefined, 20), manifest('chat', 4, 40), manifest('ai', 1, 60), manifest('meetings', 3, 30), manifest('tasks', 2, 15)]
const features = manifests.map(item => item.feature)
const me = (grants: string[]) => ({ capabilities: grants, platform: { state: 'active', read_only: false, readable_features: features, writable_features: features } })
const everything = manifests.map(item => `${item.id}.read`)
const translate = (key: string) => `t:${key}`
const rail = (grants: string[]) => withManifests(manifests, () => railModel(visibleShellModules(me(grants))))
const items = (grants: string[], extra: Partial<Parameters<typeof coreAppItems>[0]> = {}) =>
  coreAppItems({ core: rail(grants).core, activeModule: null, badges: {}, translate, ...extra })

describe('core apps row', () => {
  it('lists «يومي» then the core applications by their manifest position, with the name, icon and route the manifest gives', () => {
    const row = items(everything)
    expect(row.map(item => item.id)).toEqual(['home', 'ai', 'tasks', 'meetings', 'chat', 'documents'])
    expect(row[2]).toMatchObject({ label: 't:nav.tasks', icon: 'i-lucide-tasks', to: '/tasks' })
    expect(row[0]).toMatchObject({ label: 't:nav.home', to: '/' })
  })

  it('shows only what the user can reach: an application without the capability is absent', () => {
    expect(items(['tasks.read', 'chat.read']).map(item => item.id)).toEqual(['home', 'tasks', 'chat'])
    expect(items(['projects.read']).map(item => item.id)).toEqual(['home'])
  })

  it('lights only the open module', () => {
    expect(items(everything, { activeModule: 'meetings' }).filter(item => item.active).map(item => item.id)).toEqual(['meetings'])
    expect(items(everything, { activeModule: 'projects' }).some(item => item.active)).toBe(false)
  })

  it('carries a badge only when it is a positive number', () => {
    const row = items(everything, { badges: { tasks: 4, chat: 0, meetings: null } })
    expect(row.find(item => item.id === 'tasks')!.count).toBe(4)
    for (const id of ['chat', 'meetings', 'ai', 'home']) expect(row.find(item => item.id === id)!.count).toBeUndefined()
  })

  it('leaves the core applications out of the «تطبيقاتي» list and the pins', () => {
    const model = rail(everything)
    expect(model.applications.map(item => item.id)).toEqual(['projects'])
    expect(pinnedApplications(model, ['projects', 'tasks', 'ai']).map(item => item.id)).toEqual(['projects'])
  })
})
