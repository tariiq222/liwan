import { describe, expect, it } from 'vitest'
import manifest from '../manifest'
import { appManifests, manifestForPath, settingsPartForPath } from '../../manifests'
import { canUse, featureForCapability, featureForPath, MODULE_FEATURES } from '../../registry'
import { canReachPath, requiredCapabilityForPath } from '../../../utils/accessPolicy'
import { visibleSettingsPages, visibleShellModules } from '../../../composables/nav/shellModules'

const reader = { role: 'user', capabilities: ['customers.read'] }
const manager = { role: 'user', capabilities: ['customers.read', 'customers.manage'] }
const settingsManager = { role: 'user', capabilities: ['customers.settings.manage'] }
const open = { readable_features: ['customers.enabled'], writable_features: ['customers.enabled'] }

describe('customers manifest', () => {
  it('is discovered, owns /customers and sits behind the derived customers.enabled feature', () => {
    expect(appManifests.map(item => item.id)).toContain('customers')
    expect(manifestForPath('/customers/4')?.id).toBe('customers')
    expect(manifest.feature).toBe('customers.enabled')
    expect(MODULE_FEATURES.customers).toBe('customers.enabled')
    expect(featureForPath('/customers')).toBe('customers.enabled')
    expect(featureForPath('/settings/apps/customers')).toBe('customers.enabled')
    expect(featureForCapability('customers.read')).toBe('customers.enabled')
    expect(featureForCapability('customers.export')).toBe('customers.enabled')
  })

  it('closes the rail entry and the routes without the feature, and opens them with it', () => {
    const withFeature = { ...manager, platform: open }
    const without = { ...manager, platform: { readable_features: ['hr.enabled'], writable_features: [] } }
    expect(visibleShellModules(withFeature).map(item => item.id)).toContain('customers')
    expect(visibleShellModules(without).map(item => item.id)).not.toContain('customers')
    expect(canReachPath(withFeature, '/customers')).toBe(true)
    expect(canReachPath(without, '/customers')).toBe(false)
    expect(canReachPath(without, '/customers/4')).toBe(false)
  })

  it('keeps reads and closes writes when the feature is readable but not writable', () => {
    const readOnly = { ...manager, capabilities: [...manager.capabilities, 'customers.settings.manage'], platform: { readable_features: ['customers.enabled'], writable_features: [] } }
    expect(canReachPath(readOnly, '/customers')).toBe(true)
    expect(canUse(readOnly, 'customers.read')).toBe(true)
    expect(canUse(readOnly, 'customers.manage')).toBe(false)
    expect(canReachPath(readOnly, '/customers/new')).toBe(false)
    expect(canReachPath(readOnly, '/settings/apps/customers')).toBe(false)
  })

  it.each([
    ['/customers', 'customers.read'],
    ['/customers/4', 'customers.read'],
    ['/customers/new', 'customers.manage'],
    ['/customers/4/edit', 'customers.manage'],
    ['/settings/apps/customers', 'customers.settings.manage'],
  ])('%s needs %s', (path, capability) => {
    expect(requiredCapabilityForPath(path)).toBe(capability)
  })

  it('opens the directory to a reader, the create panel and the editor to a manager only', () => {
    expect(canReachPath(reader, '/customers')).toBe(true)
    expect(canReachPath(reader, '/customers/4')).toBe(true)
    expect(canReachPath(reader, '/customers/new')).toBe(false)
    expect(canReachPath(reader, '/customers/4/edit')).toBe(false)
    expect(canReachPath(manager, '/customers/new')).toBe(true)
    expect(canReachPath({ role: 'user', capabilities: [] }, '/customers')).toBe(false)
  })

  it('registers the settings page for the settings capability only', () => {
    expect(settingsPartForPath('/settings/apps/customers')?.part.id).toBe('sharing')
    expect(canReachPath(settingsManager, '/settings/apps/customers')).toBe(true)
    expect(canReachPath(reader, '/settings/apps/customers')).toBe(false)
    expect(visibleSettingsPages(settingsManager).map(({ page }) => page.id)).toContain('customers')
    expect(visibleSettingsPages(reader).map(({ page }) => page.id)).not.toContain('customers')
    expect(manifest.settings?.parts.map(part => part.id)).toEqual(['sharing', 'partyKinds', 'phoneCountry', 'fields'])
  })
})
