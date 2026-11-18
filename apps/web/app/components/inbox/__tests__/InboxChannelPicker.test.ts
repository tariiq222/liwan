import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'

const filename = new URL('../InboxChannelPicker.vue', import.meta.url).pathname
const WHATSAPP = (id: number) => ({ id, name: `رقم ${id}`, kind: 'whatsapp', department: null })
const TIKTOK = { id: 9, name: 'حساب', kind: 'tiktok', department: null }

function mountPicker(section: 'templates' | 'flows', capabilities: string[], items: unknown[], loading = false) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'inbox-channel-picker' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const navigateTo = vi.fn()
  const query = () => ({ data: Vue.ref({ items }), isLoading: Vue.ref(loading), error: Vue.ref(null), refetch: vi.fn() })
  const bindings = {
    _defineComponent: Vue.defineComponent, _unref: Vue.unref, computed: Vue.computed, watch: Vue.watch, navigateTo,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useAccess: () => ({ can: (key: string) => capabilities.includes(key) }),
    useInboxChannels: query, useInboxChannelWork: query, CHANNEL_KIND_ICON: { whatsapp: 'wa', tiktok: 'tt' },
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const state = Vue.effectScope().run(() => component.setup(Vue.reactive({ section }), { expose: () => {}, emit: () => {} }))
  return { state: Vue.proxyRefs(state), navigateTo }
}

describe('InboxChannelPicker', () => {
  it('opens the section of the only WhatsApp channel at once, replacing the picker in the history', () => {
    const { navigateTo } = mountPicker('templates', ['inbox.templates.manage'], [WHATSAPP(4), TIKTOK])
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith('/settings/apps/inbox/channels/4/templates', { replace: true })
  })

  it('opens the forms section for the forms picker', () => {
    const { navigateTo } = mountPicker('flows', ['inbox.channels.manage'], [WHATSAPP(4)])
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith('/settings/apps/inbox/channels/4/flows', { replace: true })
  })

  it('lists the WhatsApp channels without redirecting when there are several', () => {
    const { state, navigateTo } = mountPicker('templates', ['inbox.templates.manage'], [WHATSAPP(4), WHATSAPP(5), TIKTOK])
    expect(navigateTo).not.toHaveBeenCalled()
    expect(state.channels.map((channel: { id: number }) => channel.id)).toEqual([4, 5])
    expect(state.sectionPath(5)).toBe('/settings/apps/inbox/channels/5/templates')
  })

  it('is empty, without redirecting, when only a TikTok channel exists', () => {
    const { state, navigateTo } = mountPicker('templates', ['inbox.channels.manage'], [TIKTOK])
    expect(navigateTo).not.toHaveBeenCalled()
    expect(state.channels).toEqual([])
    expect(state.canAdmin).toBe(true)
  })

  it('waits while loading, and refuses a viewer holding neither right', () => {
    expect(mountPicker('templates', ['inbox.templates.manage'], [WHATSAPP(4)], true).navigateTo).not.toHaveBeenCalled()
    const refused = mountPicker('templates', ['inbox.flows.manage'], [WHATSAPP(4)])
    expect(refused.state.allowed).toBe(false)
    expect(refused.navigateTo).not.toHaveBeenCalled()
  })
})
