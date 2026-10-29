import { describe, expect, it } from 'vitest'
import { canReachPath } from '../../../utils/accessPolicy'

const CHANNEL = '/settings/apps/inbox/channels/4'
const TEMPLATES = `${CHANNEL}/templates`
const reach = (path: string, ...capabilities: string[]) => canReachPath({ capabilities }, path)

describe('inbox template pages', () => {
  it.each([TEMPLATES, `${TEMPLATES}/9`])('%s opens for a templates manager without channel administration, and for a channels manager', (path) => {
    expect(reach(path, 'inbox.templates.manage')).toBe(true)
    expect(reach(path, 'inbox.channels.manage')).toBe(true)
    expect(reach(path, 'inbox.conversations.read')).toBe(false)
    expect(reach(path)).toBe(false)
  })

  it('creating a template needs the templates capability, not channel administration', () => {
    expect(reach(`${TEMPLATES}/new`, 'inbox.templates.manage')).toBe(true)
    expect(reach(`${TEMPLATES}/new`, 'inbox.channels.manage')).toBe(false)
  })

  it('the channel pages stay behind channel administration', () => {
    expect(reach(CHANNEL, 'inbox.channels.manage')).toBe(true)
    expect(reach(CHANNEL, 'inbox.templates.manage')).toBe(false)
    expect(reach('/settings/apps/inbox/channels/new', 'inbox.templates.manage')).toBe(false)
  })
})

describe('inbox catalog pages', () => {
  const CATALOG = '/settings/apps/inbox/catalog'
  const withFeatures = (capabilities: string[], features: string[]) => ({ capabilities, platform: { readable_features: features, writable_features: features } })
  const on = ['inbox.enabled', 'inbox.catalog']

  it('every catalog page needs the catalog capability, not channel or settings administration', () => {
    for (const path of [CATALOG, `${CATALOG}/new`, `${CATALOG}/3`, `${CATALOG}/3/items/new`, `${CATALOG}/3/items/9`]) {
      expect(canReachPath(withFeatures(['inbox.catalog.manage'], on), path)).toBe(true)
      expect(canReachPath(withFeatures(['inbox.channels.manage', 'inbox.settings.manage', 'inbox.conversations.read'], on), path)).toBe(false)
    }
  })

  it('the catalog pages and the orders page are closed when the tenant has no catalog feature', () => {
    expect(canReachPath(withFeatures(['inbox.catalog.manage'], ['inbox.enabled']), CATALOG)).toBe(false)
    expect(canReachPath(withFeatures(['inbox.conversations.read'], ['inbox.enabled']), '/inbox/orders')).toBe(false)
    expect(canReachPath(withFeatures(['inbox.conversations.read'], on), '/inbox/orders')).toBe(true)
  })
})
