import { describe, expect, it } from 'vitest'
import manifest from '../manifest'
import { appManifests, manifestForPath, settingsPartForPath } from '../../manifests'
import { featureForPath } from '../../registry'
import { canReachPath, firstAllowedPath, requiredCapabilityForPath } from '../../../utils/accessPolicy'
import { visibleSettingsPages } from '../../../composables/nav/shellModules'

const MANAGE = 'payments.providers.manage'
const open = { readable_features: ['payments.enabled'], writable_features: ['payments.enabled'] }
const admin = { role: 'admin', capabilities: [MANAGE], platform: open }

describe('payments manifest', () => {
  it('is discovered and adds only a settings page: no rail entry, navigation item or route of its own', () => {
    expect(appManifests.map(item => item.id)).toContain('payments')
    expect(manifest.feature).toBe('payments.enabled')
    expect(manifest.rail).toEqual([])
    expect(manifest.nav).toEqual([])
    expect(manifestForPath('/settings/apps/payments')).toBeNull()
    expect(settingsPartForPath('/settings/apps/payments')?.part.id).toBe('providers')
  })

  it('gates the page by the capability and the feature behind it', () => {
    expect(requiredCapabilityForPath('/settings/apps/payments')).toBe(MANAGE)
    expect(featureForPath('/settings/apps/payments')).toBe('payments.enabled')
    expect(canReachPath(admin, '/settings/apps/payments')).toBe(true)
    expect(canReachPath({ ...admin, capabilities: [] }, '/settings/apps/payments')).toBe(false)
    expect(canReachPath({ ...admin, platform: { readable_features: ['hr.enabled'], writable_features: [] } }, '/settings/apps/payments')).toBe(false)
  })

  it('closes the page to a tenant that can only read the feature, because managing keys is a write', () => {
    const readOnly = { ...admin, platform: { readable_features: ['payments.enabled'], writable_features: [] } }
    expect(canReachPath(readOnly, '/settings/apps/payments')).toBe(false)
  })

  it('appears in the settings pages of an administrator only, and is somewhere to land', () => {
    expect(visibleSettingsPages(admin).map(({ page }) => page.id)).toContain('payments')
    expect(visibleSettingsPages({ ...admin, capabilities: [] }).map(({ page }) => page.id)).not.toContain('payments')
    expect(firstAllowedPath(admin)).toBe('/settings/apps/payments')
  })
})
