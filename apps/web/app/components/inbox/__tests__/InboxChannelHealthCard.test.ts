import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import type { InboxChannelHealth } from '@webvue/contracts'

const filename = new URL('../InboxChannelHealthCard.vue', import.meta.url).pathname
const HEALTH: InboxChannelHealth = {
  display_phone_number: '966500000000', verified_name: 'عيادة الأمل', name_status: 'approved', requested_name: null, name_rejection_reason: null, quality_rating: 'green',
  messaging_limit: 'tier_2k', throughput_level: 'standard', code_verified: true, account_state: 'active', account_restricted_until: null, checked_at: null,
  template_insights_enabled: false, currency: null, analytics_synced_at: null, analytics_error: null,
}

function mountCard(health: Partial<InboxChannelHealth> = {}) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'inbox-health-card' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const known = new Set(['inbox.health.nameReasons.NAME_NOT_CONSISTENT'])
  const bindings = {
    _defineComponent: Vue.defineComponent, _unref: Vue.unref, computed: Vue.computed,
    useI18n: () => ({ t: (key: string, params?: Record<string, string>) => params ? `${key}|${Object.values(params).join(',')}` : key, te: (key: string) => known.has(key) }),
    formatDateTime: (value: string) => `<${value}>`,
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  return Vue.proxyRefs(Vue.effectScope().run(() => component.setup(Vue.reactive({ health: { ...HEALTH, ...health } }), { expose: () => {}, emit: () => {} })))
}

describe('InboxChannelHealthCard', () => {
  it('shows no banner while the account is active', () => {
    expect(mountCard().accountBanner).toBeNull()
  })

  it.each(['restricted', 'scheduled_for_disable', 'disabled'] as const)('shows the %s banner', (state) => {
    expect(mountCard({ account_state: state }).accountBanner).toBe(state)
  })

  it('says until when a restriction lasts, or that no date is known', () => {
    expect(mountCard({ account_state: 'restricted', account_restricted_until: '2026-11-01T00:00:00Z' }).bannerDescription).toBe('inbox.health.account.restrictedUntil|<2026-11-01T00:00:00Z>')
    expect(mountCard({ account_state: 'restricted' }).bannerDescription).toBe('inbox.health.account.restrictedNoDate')
    expect(mountCard({ account_state: 'disabled' }).bannerDescription).toBe('inbox.health.account.disabledHint')
  })

  it('joins the name status with the requested name and the readable rejection reason', () => {
    const card = mountCard({ name_status: 'declined', requested_name: 'اسم جديد', name_rejection_reason: 'NAME_NOT_CONSISTENT' })
    expect(card.nameHint).toBe('inbox.health.nameStatus.declined · inbox.health.tiles.requested|اسم جديد · inbox.health.nameReasons.NAME_NOT_CONSISTENT')
    expect(mountCard({ name_rejection_reason: 'SOMETHING_NEW' }).nameHint).toContain('SOMETHING_NEW')
  })

  it('maps the quality rating to a tone', () => {
    expect(mountCard().QUALITY_TONE).toEqual({ green: 'success', yellow: 'warning', red: 'danger', unknown: 'neutral' })
  })
})
