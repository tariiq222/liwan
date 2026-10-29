import { describe, expect, it, vi } from 'vitest'
import manifest from '../manifest'
import { appManifests, manifestForPath, settingsPartForPath } from '../../manifests'
import { bellKindFor } from '../../surfaces'
import { canReachPath, requiredCapabilityForPath } from '../../../utils/accessPolicy'

const BELL_KINDS = ['crm.assigned', 'crm.followup_due', 'crm.needs_manager']

describe('crm manifest', () => {
  it('is discovered and owns /crm behind crm.enabled', () => {
    expect(appManifests.map(item => item.id)).toContain('crm')
    expect(manifestForPath('/crm/opportunities/4')?.id).toBe('crm')
    expect(manifest.feature).toBe('crm.enabled')
    expect(manifest.rail).toEqual([{ id: 'crm', labelKey: 'nav.crm', icon: 'i-lucide-handshake', to: '/crm', order: 85 }])
  })

  it('takes a rail order and a shortcut no other manifest uses', () => {
    const others = appManifests.filter(item => item.id !== 'crm')
    expect(others.flatMap(item => item.rail).map(entry => entry.order)).not.toContain(85)
    const shortcuts = manifest.nav.map(item => item.shortcut).filter(Boolean)
    expect(others.flatMap(item => item.nav).map(item => item.shortcut)).not.toContain(shortcuts[0])
  })

  it.each([
    ['/crm', 'crm.leads.read'],
    ['/crm/opportunities', 'crm.leads.read'],
    ['/crm/opportunities/9', 'crm.leads.read'],
    ['/crm/opportunities/new', 'crm.leads.read'],
    ['/crm/imports', 'crm.leads.import'],
    ['/crm/imports/new', 'crm.leads.import'],
  ])('requires the capability of %s', (path, capability) => {
    expect(requiredCapabilityForPath(path)).toBe(capability)
  })

  it('opens the create route to work or assign, and to neither of them otherwise', () => {
    const reach = (...capabilities: string[]) => canReachPath({ capabilities }, '/crm/opportunities/new')
    expect(reach('crm.leads.read', 'crm.leads.assign')).toBe(true)
    expect(reach('crm.leads.read', 'crm.leads.work')).toBe(true)
    expect(reach('crm.leads.read')).toBe(false)
    expect(reach('crm.leads.assign')).toBe(false)
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

  it('has no bell target when the row carries no opportunity id', () => {
    for (const kind of BELL_KINDS) {
      expect(bellKindFor(kind)?.href({ id: 3, kind, title: 'Mona' }), kind).toBeNull()
    }
  })

  it('opens an opportunity from every bell kind', () => {
    for (const kind of BELL_KINDS) {
      expect(bellKindFor(kind)?.href({ id: 3, kind, opportunity_id: 17, title: 'Mona' }), kind).toBe('/crm/opportunities/17')
    }
  })

  it('words every bell kind with the app translator and the company term of the row', () => {
    const messages: Record<string, string> = { 'crm.bell.followupDue': 'متابعة: {name}', 'crm.bell.needsManager': 'قرار: {name}', 'crm.bell.assigned': 'إسناد {term}: {name}' }
    const t = vi.fn((key: string, named: Record<string, string>) => messages[key]!.replace(/\{(\w+)\}/g, (_, name: string) => named[name]!))
    vi.stubGlobal('useNuxtApp', () => ({ $i18n: { t, locale: { value: 'ar' } } }))
    const term = { ar: { singular: 'حالة', plural: 'حالات' }, en: { singular: 'case', plural: 'cases' }, gender: 'f' }
    const row = (kind: string) => ({ id: 3, kind, opportunity_id: 17, title: 'Mona', count: 1, term, created_at: '2026-10-28T09:00:00Z', is_read: false })
    expect(BELL_KINDS.map(kind => bellKindFor(kind)?.title?.(row(kind), key => key))).toEqual(['إسناد حالة: Mona', 'متابعة: Mona', 'قرار: Mona'])
    vi.unstubAllGlobals()
  })
})
