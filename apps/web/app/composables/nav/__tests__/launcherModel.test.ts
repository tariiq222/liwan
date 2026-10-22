import { describe, expect, it } from 'vitest'
import { launcherEntries } from '../launcherModel'
import { withManifests } from '../../../modules/manifests'
import type { AppManifest } from '../../../modules/types'
const manifest: AppManifest = {
  id: 'work', feature: 'work.enabled', routePrefixes: ['/work'],
  rail: [{ id: 'work', labelKey: 'nav.work', icon: 'i-lucide-circle', to: '/work', order: 1 }],
  nav: [{ to: '/work', labelKey: 'nav.work', icon: 'i-lucide-circle', shortcut: '', capability: 'work.items.read' }],
  commands: [
    { id: 'work.new', labelKey: 'work.new', icon: 'i-lucide-plus', to: '/work/new', capability: 'work.items.create' },
    { id: 'work.secret', labelKey: 'work.secret', icon: 'i-lucide-plus', to: '/work/secret', capability: 'work.secret.manage' },
  ],
}
const me = (caps: string[]) => ({ capabilities: caps, platform: { readable_features: ['work.enabled'], writable_features: ['work.enabled'] } })
const entries = (caps: string[], query = '') => withManifests([manifest], () => launcherEntries(me(caps), query, () => 'العمل'))

describe('practical launcher', () => {
  it('lists reachable applications and the existing permitted actions', () => {
    const result = entries(['work.items.read', 'work.items.create'])
    expect(result.map(item => item.id)).toEqual(['work'])
    expect(result[0]?.to).toBe('/work')
    expect(result[0]?.actions.map(item => item.to)).toEqual(['/work/new'])
  })
  it('keeps a read-only application usable without creation controls', () => {
    expect(entries(['work.items.read'])[0]?.actions).toEqual([])
    expect(entries([])).toEqual([])
  })
  it('filters names and returns no matches for an unknown name', () => {
    expect(entries(['work.items.read'], '  عم  ')).toHaveLength(1)
    expect(entries(['work.items.read'], 'zzz')).toEqual([])
  })
  it('keeps at most three distinct permitted actions', () => {
    const command = manifest.commands![0]!
    const commands = [command, command, ...Array.from({ length: 5 }, (_, index) => ({ ...command, id: `work.action-${index}`, to: `/work/action-${index}` }))]
    const result = withManifests([{ ...manifest, commands }], () => launcherEntries(me(['work.items.read', 'work.items.create']), '', () => 'Work'))
    expect(result[0]?.actions.map(action => action.to)).toEqual(['/work/new', '/work/action-0', '/work/action-1'])
  })
})
