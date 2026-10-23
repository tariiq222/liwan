import { describe, expect, it } from 'vitest'
import manifest from '../manifest'
import chat from '../../chat/manifest'
import hr from '../../hr/manifest'
import meetings from '../../meetings/manifest'
import pmo from '../../pmo/manifest'

describe('tasks manifest', () => {
  it('declares the application identity and prefix', () => {
    expect(manifest.id).toBe('tasks')
    expect(manifest.feature).toBe('tasks.enabled')
    expect(manifest.routePrefixes).toEqual(['/my-tasks', '/work'])
  })

  it('has one rail entry at order 15 that no other manifest uses', () => {
    expect(manifest.rail).toEqual([
      { id: 'tasks', labelKey: 'nav.myTasks', icon: 'i-lucide-check-square', to: '/my-tasks', order: 15 },
    ])
    const others = [chat, hr, meetings, pmo].flatMap(m => m.rail).map(r => r.order)
    expect(others).not.toContain(15)
  })

  it('uses a nav shortcut no other manifest uses', () => {
    const shortcut = 'a'
    expect(manifest.nav).toEqual([
      { to: '/my-tasks', labelKey: 'nav.myTasks', icon: 'i-lucide-check-square', shortcut, capability: 'tasks.tasks.read' },
    ])
    const used = [chat, hr, meetings, pmo].flatMap(m => m.nav ?? []).map(n => n.shortcut)
    expect(used).not.toContain(shortcut)
  })

  it('pins the new-task context link behind the create capability', () => {
    const links = manifest.contextLinks?.('/my-tasks') ?? []
    expect(links.find(l => l.id === 'new-task')).toMatchObject({
      to: '/my-tasks/new', capability: 'tasks.tasks.create', pinned: true,
    })
  })

  it('links the work page «عملي» next to the new-task action, behind the read capability', () => {
    const links = manifest.contextLinks?.('/my-tasks') ?? []
    expect(links.find(l => l.id === 'work')).toMatchObject({ to: '/work', labelKey: 'myTasks.work.nav', capability: 'tasks.tasks.read', exact: true })
    expect(links.map(l => l.id)).toEqual(['new-task', 'work'])
  })

  it('lands on /my-tasks, gates /my-tasks/new on create and /work on read', () => {
    expect(manifest.landing).toEqual([{ path: '/my-tasks', capability: 'tasks.tasks.read' }])
    expect(manifest.routeCapabilities).toHaveLength(2)
    const create = manifest.routeCapabilities!.find(r => r.pattern.test('/my-tasks/new'))!
    expect(create.pattern.test('/my-tasks/5')).toBe(false)
    expect(create.capability).toBe('tasks.tasks.create')
    const work = manifest.routeCapabilities!.find(r => r.pattern.test('/work'))!
    expect(work.pattern.test('/work/other')).toBe(false)
    expect(work.capability).toBe('tasks.tasks.read')
  })

  it('maps the tasks.assigned bell kind to the personal task', () => {
    expect(manifest.bell?.capabilities).toEqual(['tasks.tasks.read'])
    const kind = manifest.bell!.kinds!.find(k => k.kind === 'tasks.assigned')!
    const t = ((key: string) => key) as never
    expect(kind.href({ task_id: 9 })).toBe('/my-tasks/9')
    expect(kind.title!({ title: 'T', task_name: 'N' }, t)).toBe('T')
    expect(kind.title!({ task_name: 'N' }, t)).toBe('N')
  })

  it('is the only manifest that mentions /my-tasks', () => {
    for (const other of [chat, hr, meetings, pmo]) {
      expect(JSON.stringify(other, (_k, v) => (typeof v === 'function' ? v.toString() : v instanceof RegExp ? v.source : v)))
        .not.toContain('/my-tasks')
    }
  })
})
