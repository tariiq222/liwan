import { describe, expect, it } from 'vitest'
import manifest from '../manifest'
import { settingsPartForPath } from '../../manifests'
import { canReachPath } from '../../../utils/accessPolicy'

const tenant = (capabilities: string[]) => ({
  role: 'user', capabilities, platform: { readable_features: ['sales.enabled'], writable_features: ['sales.enabled'] },
})
const reachable = (path: string, capabilities: string[]) => canReachPath(tenant(capabilities), path)

describe('sales settings: templates and presets', () => {
  const parts = manifest.settings?.parts ?? []

  it('lists the presets as a card and the templates as a page of their own, both for the settings manager', () => {
    const presets = parts.find(part => part.id === 'presets')
    const templates = parts.find(part => part.id === 'templates')
    expect(presets).toMatchObject({ capability: 'sales.settings.manage' })
    expect(presets?.to).toBeUndefined()
    expect(templates).toMatchObject({ capability: 'sales.settings.manage', to: '/settings/apps/sales/templates', within: '/settings/apps/sales/templates' })
  })

  it('opens the template pages to the settings manager and no one else', () => {
    for (const path of ['/settings/apps/sales/templates', '/settings/apps/sales/templates/new', '/settings/apps/sales/templates/7', '/settings/apps/sales/templates/7/edit']) {
      expect(reachable(path, ['sales.settings.manage']), path).toBe(true)
      expect(reachable(path, ['sales.read', 'sales.quotations.manage']), path).toBe(false)
    }
  })

  it('keeps the sidebar part of the templates active on its records', () => {
    expect(settingsPartForPath('/settings/apps/sales/templates/7/edit')?.part.id).toBe('templates')
    expect(settingsPartForPath('/settings/apps/sales/templates/new')?.part.id).toBe('templates')
  })
})
