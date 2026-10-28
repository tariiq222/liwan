import { describe, expect, it } from 'vitest'
import manifest from '../manifest'
import { appManifests, manifestForPath, settingsPartForPath } from '../../manifests'
import { bellKindFor } from '../../surfaces'
import { requiredCapabilityForPath } from '../../../utils/accessPolicy'

describe('crm manifest', () => {
  it('is discovered and owns /crm behind crm.enabled', () => {
    expect(appManifests.map(item => item.id)).toContain('crm')
    expect(manifestForPath('/crm/opportunities/4')?.id).toBe('crm')
    expect(manifest.feature).toBe('crm.enabled')
    expect(manifest.rail).toEqual([{ id: 'crm', labelKey: 'nav.crm', icon: 'i-lucide-handshake', to: '/crm', order: 80 }])
  })

  it('takes a rail order and a shortcut no other manifest uses', () => {
    const others = appManifests.filter(item => item.id !== 'crm')
    expect(others.flatMap(item => item.rail).map(entry => entry.order)).not.toContain(80)
    const shortcuts = manifest.nav.map(item => item.shortcut).filter(Boolean)
    expect(others.flatMap(item => item.nav).map(item => item.shortcut)).not.toContain(shortcuts[0])
  })

  it.each([
    ['/crm', 'crm.leads.read'],
    ['/crm/opportunities', 'crm.leads.read'],
    ['/crm/opportunities/9', 'crm.leads.read'],
    ['/crm/opportunities/new', 'crm.leads.work'],
    ['/crm/imports', 'crm.leads.import'],
    ['/crm/imports/new', 'crm.leads.import'],
  ])('requires the capability of %s', (path, capability) => {
    expect(requiredCapabilityForPath(path)).toBe(capability)
  })

  it('lists the dashboard, the opportunities and the imports in the nav', () => {
    expect(manifest.nav.map(item => [item.to, item.capability])).toEqual([
      ['/crm', 'crm.leads.read'], ['/crm/opportunities', 'crm.leads.read'], ['/crm/imports', 'crm.leads.import'],
    ])
  })

  it('registers one settings page with the eleven cards, read by crm.settings.read', () => {
    expect(manifest.settings?.to).toBe('/settings/apps/crm')
    expect(manifest.settings?.parts.map(part => part.id)).toEqual([
      'preset', 'terms', 'followup', 'distribution', 'privacy', 'pricing', 'packages', 'stages', 'outcomes', 'lostReasons', 'sources',
    ])
    expect(new Set(manifest.settings?.parts.map(part => part.capability))).toEqual(new Set(['crm.settings.read']))
    expect(settingsPartForPath('/settings/apps/crm')?.part.capability).toBe('crm.settings.read')
  })

  it('opens an opportunity from both bell kinds', () => {
    for (const kind of ['crm.assigned', 'crm.followup_due']) {
      expect(bellKindFor(kind)?.href({ id: 3, kind, opportunity_id: 17, title: 'Mona' }), kind).toBe('/crm/opportunities/17')
    }
  })
})
