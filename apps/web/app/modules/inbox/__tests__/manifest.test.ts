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
