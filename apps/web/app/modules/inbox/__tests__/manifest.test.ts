import { describe, expect, it } from 'vitest'
import { appRootFallback, canReachPath } from '../../../utils/accessPolicy'
import manifest from '../manifest'
import ar from '../../../../i18n/locales/ar/inbox.json'
import en from '../../../../i18n/locales/en/inbox.json'

it('presents customer messages consistently without changing inbox routes', () => {
  expect(ar.inbox.title).toBe('رسائل العملاء')
  expect(ar.inbox.railLabel).toBe('الرسائل')
  expect(en.inbox.title).toBe('Customer Messages')
  expect(en.inbox.railLabel).toBe('Messages')
  expect(manifest.rail[0]).toMatchObject({ icon: 'i-lucide-messages-square', to: '/inbox' })
  expect(manifest.nav.find(item => item.to === '/inbox')?.icon).toBe('i-lucide-messages-square')
  expect(manifest.settings).toMatchObject({ icon: 'i-lucide-messages-square', to: '/settings/apps/inbox' })
})

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

const FLOWS = `${CHANNEL}/flows`
describe('inbox form pages', () => {
  it.each([FLOWS, `${FLOWS}/9`])('%s opens for a forms manager without channel administration, and for a channels manager', (path) => {
    expect(reach(path, 'inbox.flows.manage')).toBe(true)
    expect(reach(path, 'inbox.channels.manage')).toBe(true)
    expect(reach(path, 'inbox.conversations.read')).toBe(false)
    expect(reach(path)).toBe(false)
  })

  it('creating a form needs the forms capability, not channel administration', () => {
    expect(reach(`${FLOWS}/new`, 'inbox.flows.manage')).toBe(true)
    expect(reach(`${FLOWS}/new`, 'inbox.channels.manage')).toBe(false)
  })

  it('the responses page is part of the inbox: reading conversations opens it', () => {
    expect(reach('/inbox/flows/9', 'inbox.conversations.read')).toBe(true)
    expect(reach('/inbox/flows/9')).toBe(false)
  })
})

describe('inbox reports', () => {
  const REPORTS = '/inbox/reports'

  it('a reports-only role reaches the reports pages but not the conversations', () => {
    for (const path of [REPORTS, `${REPORTS}/costs`, `${REPORTS}/templates`, `${REPORTS}/templates/7`]) {
      expect(reach(path, 'inbox.reports.read')).toBe(true)
      expect(reach(path, 'inbox.conversations.read')).toBe(false)
    }
    expect(reach('/inbox', 'inbox.reports.read')).toBe(false)
    expect(reach('/inbox/12', 'inbox.reports.read')).toBe(false)
  })

  it('an agent without the reports capability keeps the conversations and never sees the reports', () => {
    expect(reach('/inbox', 'inbox.conversations.read')).toBe(true)
    expect(reach(REPORTS)).toBe(false)
  })

  it('opens the reports landing for a reports-only role when the inbox root is closed to it', () => {
    expect(appRootFallback({ capabilities: ['inbox.reports.read'] }, '/inbox')).toBe(REPORTS)
    expect(appRootFallback({ capabilities: ['inbox.conversations.read'] }, '/inbox')).toBeNull()
  })

  it('does not light the conversations item on a report page', () => {
    expect(manifest.isNavActive?.(`${REPORTS}/costs`, '/inbox')).toBe(false)
    expect(manifest.isNavActive?.('/inbox/12', '/inbox')).toBeUndefined()
    expect(manifest.isNavActive?.(`${REPORTS}/costs`, REPORTS)).toBeUndefined()
  })

  it('the number health pages stay behind channel administration, and its alerts reach the managers\' bell', () => {
    for (const page of ['health', 'profile']) {
      expect(reach(`${CHANNEL}/${page}`, 'inbox.channels.manage')).toBe(true)
      expect(reach(`${CHANNEL}/${page}`, 'inbox.templates.manage')).toBe(false)
      expect(reach(`${CHANNEL}/${page}`, 'inbox.reports.read')).toBe(false)
    }
    expect(manifest.bell?.capabilities).toContain('inbox.channels.manage')
    const kind = manifest.bell?.kinds?.find(item => item.kind === 'inbox.channel_health')
    expect(kind?.href({ channel_id: 4 })).toBe(`${CHANNEL}/health`)
    expect(kind?.title?.({ title: 'واتساب' }, (key: string) => key)).toBe('واتساب')
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

  it('a form answers page needs the forms feature besides reading conversations', () => {
    expect(canReachPath(withFeatures(['inbox.conversations.read'], ['inbox.enabled']), '/inbox/flows/4')).toBe(false)
    expect(canReachPath(withFeatures(['inbox.conversations.read'], ['inbox.enabled', 'inbox.flows']), '/inbox/flows/4')).toBe(true)
    expect(canReachPath(withFeatures(['inbox.flows.manage'], ['inbox.enabled', 'inbox.flows']), '/inbox/flows/4')).toBe(false)
  })
})

describe('inbox campaigns', () => {
  const CAMPAIGNS = '/inbox/campaigns'
  const PAGES = [CAMPAIGNS, `${CAMPAIGNS}/new`, `${CAMPAIGNS}/7`, `${CAMPAIGNS}/audiences`, `${CAMPAIGNS}/audiences/new`, `${CAMPAIGNS}/audiences/3`]

  it('a campaigns-only role reaches the campaign pages but not the conversations', () => {
    for (const path of PAGES) {
      expect(reach(path, 'inbox.campaigns.manage')).toBe(true)
      expect(reach(path, 'inbox.conversations.read')).toBe(false)
    }
    expect(reach('/inbox', 'inbox.campaigns.manage')).toBe(false)
    expect(reach('/inbox/12', 'inbox.campaigns.manage')).toBe(false)
  })

  it('an agent without the campaigns capability keeps the conversations and never sees the campaigns', () => {
    expect(reach('/inbox', 'inbox.conversations.read')).toBe(true)
    expect(reach(CAMPAIGNS, 'inbox.conversations.read', 'inbox.reports.read')).toBe(false)
  })

  it('matches the campaigns rule before the generic inbox rule', () => {
    const rules = manifest.routeCapabilities ?? []
    const campaigns = rules.findIndex(rule => rule.capability === 'inbox.campaigns.manage')
    const generic = rules.findIndex(rule => rule.capability === 'inbox.conversations.read')
    expect(campaigns).toBeGreaterThanOrEqual(0)
    expect(campaigns).toBeLessThan(generic)
    expect(rules[campaigns]?.feature).toBe('inbox.campaigns')
  })

  it('opens the campaigns landing for a campaigns-only role when the inbox root is closed to it', () => {
    expect(appRootFallback({ capabilities: ['inbox.campaigns.manage'] }, '/inbox')).toBe(CAMPAIGNS)
  })

  it('does not light the conversations item on a campaign page', () => {
    expect(manifest.isNavActive?.(`${CAMPAIGNS}/7`, '/inbox')).toBe(false)
    expect(manifest.isNavActive?.(`${CAMPAIGNS}/7`, CAMPAIGNS)).toBeUndefined()
  })

  it('offers the campaigns navigation entry and the settings part under the campaigns capability', () => {
    expect(manifest.nav.find(item => item.to === CAMPAIGNS)).toMatchObject({ capability: 'inbox.campaigns.manage', feature: 'inbox.campaigns' })
    expect(manifest.settings?.parts.find(part => part.id === 'campaigns')?.capability).toBe('inbox.campaigns.manage')
  })
})

describe('inbox templates and forms settings entries', () => {
  const part = (id: string) => manifest.settings?.parts.find(item => item.id === id)

  it('lists templates and forms as sidebar parts of their own pages, gated like the channel pages', () => {
    expect(part('templates')).toMatchObject({ capability: 'inbox.templates.manage', anyCapabilities: ['inbox.channels.manage'], feature: 'inbox.templates', to: '/settings/apps/inbox/templates', within: '/settings/apps/inbox/templates' })
    expect(part('flows')).toMatchObject({ capability: 'inbox.flows.manage', anyCapabilities: ['inbox.channels.manage'], feature: 'inbox.flows', to: '/settings/apps/inbox/flows', within: '/settings/apps/inbox/flows' })
  })

  it.each([['templates', 'inbox.templates.manage'], ['flows', 'inbox.flows.manage']])('the %s picker opens for its manager and for a channels manager only', (page, capability) => {
    const path = `/settings/apps/inbox/${page}`
    expect(reach(path, capability)).toBe(true)
    expect(reach(path, 'inbox.channels.manage')).toBe(true)
    expect(reach(path, 'inbox.conversations.read')).toBe(false)
    expect(reach(path)).toBe(false)
  })

  it('the forms manager does not reach the templates picker, nor the reverse', () => {
    expect(reach('/settings/apps/inbox/templates', 'inbox.flows.manage')).toBe(false)
    expect(reach('/settings/apps/inbox/flows', 'inbox.templates.manage')).toBe(false)
  })
})

describe('inbox agents settings part', () => {
  it('opens for settings managers and for assign holders, who see no other part', () => {
    const part = manifest.settings?.parts.find(item => item.id === 'agents')
    expect(part).toMatchObject({ capability: 'inbox.settings.manage', anyCapabilities: ['inbox.conversations.assign'] })
    expect(manifest.settings?.groups?.find(group => group.id === 'basics')?.parts).toContain('agents')
    expect(canReachPath({ capabilities: ['inbox.conversations.assign'] }, '/settings/apps/inbox')).toBe(true)
    expect(canReachPath({ capabilities: ['inbox.settings.manage'] }, '/settings/apps/inbox')).toBe(true)
    expect(canReachPath({ capabilities: ['inbox.conversations.reply'] }, '/settings/apps/inbox')).toBe(false)
    const others = manifest.settings?.parts.filter(item => item.id !== 'agents') ?? []
    expect(others.some(item => [item.capability, ...(item.anyCapabilities ?? [])].includes('inbox.conversations.assign'))).toBe(false)
  })
})
