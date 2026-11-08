import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { PUBLIC_API_METHODS, PUBLIC_BODY_LIMITS } from '../publicApi'
import { HOOK_SIGNATURE_HEADERS, MAX_PUBLIC_HOOK_BODY } from '../tenantTransport'

const read = (path: string) => readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8')

// Every public entry that is not an inbox hook is named here with the reason it is not one; an entry added to
// PUBLIC_API_METHODS must be classified (a hook, or listed here), so the sets below cannot drift silently.
const NOT_INBOX_HOOKS = new Map([
  ['/api/v1/branding', 'login-page branding, not a provider delivery'],
  ['/api/v1/auth/channels', 'second sign-in step, not a provider delivery'],
  ['/api/v1/auth/code', 'second sign-in step, not a provider delivery'],
  ['/api/v1/auth/verify', 'second sign-in step, not a provider delivery'],
  ['/api/v1/auth/device', 'second sign-in step, not a provider delivery'],
])
// Hooks a provider posts to the tenant directly, with no shared-SaaS relay in front.
const DIRECT_PROVIDER_HOOKS = new Map([['/api/v1/inbox/hooks/whatsapp', 'Meta calls the tenant host itself']])

const publicHooks = [...PUBLIC_API_METHODS.keys()].filter(path => !NOT_INBOX_HOOKS.has(path)).sort()
const odooHooks = Object.values(Object.fromEntries([...read('odoo-addons/liwan_inbox/controllers/channels.py')
  .match(/^HOOK_PATHS = \{(.*)\}$/m)![1]!.matchAll(/'(\w+)': '([^']+)'/g)].map(match => [match[1], match[2]]))) as string[]
const relayDestination = read('deploy/shared/tiktok-relay.mjs').match(/^const TENANT_WEBHOOK_PATH = '([^']+)'$/m)![1]!
const relayHeader = read('deploy/shared/tiktok-relay.mjs').match(/^export const SIGNATURE_HEADER = '([^']+)'$/m)![1]!

it('every public inbox hook is an Odoo hook path, and every Odoo hook path is public', () => {
  expect(publicHooks).toEqual([...odooHooks].sort())
})

it('every public inbox hook is either relayed or called directly by its provider, never neither', () => {
  expect(publicHooks.filter(path => path !== relayDestination && !DIRECT_PROVIDER_HOOKS.has(path))).toEqual([])
  expect(publicHooks).toContain(relayDestination)
})

it('each public inbox hook has the public body limit and exactly one signature header', () => {
  for (const path of publicHooks) expect(PUBLIC_BODY_LIMITS.get(path), path).toBe(MAX_PUBLIC_HOOK_BODY)
  expect([...HOOK_SIGNATURE_HEADERS.keys()].sort()).toEqual(publicHooks)
})

it('the relayed hook forwards the header the relay verifies', () => {
  expect(HOOK_SIGNATURE_HEADERS.get(relayDestination)).toBe(relayHeader)
})

it('every TikTok delivery is accepted as POST only', () => {
  expect(PUBLIC_API_METHODS.get(relayDestination)).toEqual(['POST'])
})
