import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import { deletionErrorKey } from '../../../utils/subscription'

const WINDOW_DAYS = 90 // the window the panel names; the component reads it from the contract, which pins the decided value
const component = resolve(__dirname, '../DeleteWorkspacePanel.vue')
const root = resolve(__dirname, '../../../..')
const locale = (lang: 'ar' | 'en') => JSON.parse(readFileSync(resolve(root, `i18n/locales/${lang}/subscription.json`), 'utf8')).subscription.deletion as Record<string, unknown>
const flatten = (value: Record<string, unknown>, prefix: string): Record<string, string> => Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
  typeof item === 'object' ? Object.entries(flatten(item as Record<string, unknown>, `${prefix}${key}.`)) : [[`${prefix}${key}`, String(item)]]))
const messages = flatten(locale('en'), 'subscription.deletion.')
const Field = Vue.defineComponent({ props: { label: String }, setup: (p, { slots }) => () => Vue.h('label', [p.label, slots.default?.()]) })
const Input = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('input', attrs) })
const render = (props: Record<string, unknown>) => renderShared(component, { hydrated: true, ...props }, {},
  { messages, modules: { '@liwan/commercial-contracts': { TENANT_DELETION_WINDOW_DAYS: WINDOW_DAYS, daysBetween: (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000), riyadhDate: (value: string | Date) => new Date(value).toISOString().slice(0, 10) }, '@liwan/ui/app/utils/formatDate': { formatDate: (value: string) => value.slice(0, 10) } }, stubs: { UFormField: Field, UInput: Input }, globals: { ref: Vue.ref, computed: Vue.computed, onMounted: Vue.onMounted } })
const requested = { state: 'requested', requested_at: '2026-11-20T09:00:00.000Z', code_expires_at: '2026-11-20T09:15:00.000Z', confirmed_at: null, due_at: null }
const confirmed = { state: 'confirmed', requested_at: '2026-11-20T09:00:00.000Z', code_expires_at: null, confirmed_at: '2026-11-20T09:05:00.000Z', due_at: '2027-02-18T09:05:00.000Z' }

describe('DeleteWorkspacePanel', () => {
  it('explains what is deleted and kept, the withdrawal window and the stopped renewal, with one request button', async () => {
    const html = await render({ deletion: null })
    for (const key of ['deletes', 'keeps', 'renewal', 'requestHint']) expect(html).toContain(messages[`subscription.deletion.${key}`])
    expect(html).toContain(messages['subscription.deletion.window']!.replace('{days}', String(WINDOW_DAYS)))
    expect(html).toContain('data-testid="request-deletion"')
    expect(html).not.toContain('data-testid="confirm-deletion"')
  })
  it('asks for the code and the exact company name once the code is sent, and lets the user ask again or cancel', async () => {
    const html = await render({ deletion: requested })
    expect(html).toContain(messages['subscription.deletion.codeLabel'])
    expect(html).toContain(messages['subscription.deletion.nameLabel'])
    expect(html).toContain(messages['subscription.deletion.nameHint'])
    for (const id of ['confirm-deletion', 'resend-code', 'cancel-request']) expect(html).toContain(`data-testid="${id}"`)
    expect(html).not.toContain('data-testid="request-deletion"')
  })
  it('shows the scheduled date, says nothing is deleted yet and offers to withdraw', async () => {
    const html = await render({ deletion: confirmed })
    expect(html).toContain('data-testid="deletion-scheduled"')
    expect(html).toContain('Nothing has been deleted yet')
    expect(html).toContain('data-testid="withdraw-deletion"')
    expect(html).toContain(messages['subscription.deletion.withdrawNote'])
  })
  it('has no action once the window has ended and says the team will carry it out', async () => {
    const html = await render({ deletion: { ...confirmed, state: 'due' } })
    expect(html).toContain('data-testid="deletion-due"')
    expect(html).toContain('The LiwanOS team will carry out the deletion')
    expect(html).not.toContain('<button')
  })
  it('disables every action until the page is interactive', async () => {
    const html = await render({ deletion: null, hydrated: false })
    expect(html).toMatch(/<button[^>]*disabled/)
  })
})

describe('deletion copy', () => {
  it('keeps the same keys in Arabic and English and names every refusal the control plane answers', () => {
    const keys = (value: Record<string, unknown>, prefix = ''): string[] => Object.entries(value).flatMap(([k, v]) => typeof v === 'object' ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`])
    expect(keys(locale('ar')).sort()).toEqual(keys(locale('en')).sort())
    for (const code of ['invalid_code', 'company_name_mismatch', 'rate_limited', 'deletion_pending', 'deletion_due', 'no_workspace', 'no_manager_address']) {
      expect(deletionErrorKey(code)).toBe(`subscription.deletion.errors.${code}`)
      for (const lang of ['ar', 'en'] as const) expect(typeof (locale(lang).errors as Record<string, string>)[code]).toBe('string')
    }
    expect(deletionErrorKey('anything_else')).toBe('subscription.deletion.failed')
    expect(deletionErrorKey(null)).toBe('subscription.deletion.failed')
  })
})
