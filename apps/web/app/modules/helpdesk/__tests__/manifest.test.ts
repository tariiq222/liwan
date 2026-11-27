import { describe, expect, it } from 'vitest'
import manifest from '../manifest'
import { appManifests, manifestForPath } from '../../manifests'
import { canReachPath, requiredCapabilityForPath } from '../../../utils/accessPolicy'

const features = { readable_features: ['helpdesk.enabled'], writable_features: ['helpdesk.enabled'] }
const reader = { capabilities: ['helpdesk.settings.read'], platform: features }
const manager = { capabilities: ['helpdesk.settings.read', 'helpdesk.settings.manage'], platform: features }

describe('helpdesk settings routes in manifest', () => {
  it('registers the helpdesk manifest behind helpdesk.enabled', () => {
    expect(appManifests.map(item => item.id)).toContain('helpdesk')
    expect(manifestForPath('/helpdesk')?.id).toBe('helpdesk')
    expect(manifest.feature).toBe('helpdesk.enabled')
  })

  it.each([
    ['/settings/apps/helpdesk', 'helpdesk.settings.read'],
    ['/settings/apps/helpdesk/teams/new', 'helpdesk.settings.manage'],
    ['/settings/apps/helpdesk/teams/4/edit', 'helpdesk.settings.manage'],
    ['/settings/apps/helpdesk/stages/new', 'helpdesk.settings.manage'],
    ['/settings/apps/helpdesk/stages/4/edit', 'helpdesk.settings.manage'],
    ['/settings/apps/helpdesk/sla/new', 'helpdesk.settings.manage'],
    ['/settings/apps/helpdesk/sla/4/edit', 'helpdesk.settings.manage'],
  ])('maps %s to %s', (path, capability) => {
    expect(requiredCapabilityForPath(path)).toBe(capability)
  })

  it('lets a settings reader open the overview but blocks create and edit routes', () => {
    expect(canReachPath(reader, '/settings/apps/helpdesk')).toBe(true)
    for (const path of [
      '/settings/apps/helpdesk/teams/new',
      '/settings/apps/helpdesk/teams/4/edit',
      '/settings/apps/helpdesk/stages/new',
      '/settings/apps/helpdesk/stages/4/edit',
      '/settings/apps/helpdesk/sla/new',
      '/settings/apps/helpdesk/sla/4/edit',
    ]) {
      expect(canReachPath(reader, path), path).toBe(false)
      expect(canReachPath(manager, path), path).toBe(true)
    }
  })

  it('blocks settings routes when helpdesk.enabled is off', () => {
    const disabled = { ...manager, platform: { readable_features: [], writable_features: [] } }
    expect(canReachPath(disabled, '/settings/apps/helpdesk')).toBe(false)
    expect(canReachPath(disabled, '/settings/apps/helpdesk/teams/new')).toBe(false)
  })
})
