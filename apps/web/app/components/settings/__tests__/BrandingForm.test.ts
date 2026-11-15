import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Branding } from '@liwan/contracts'
import { ApiError } from '../../../composables/useApi'
import { buildBrandingPatch, normalizeHex } from '../../../composables/colorHex'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'

const filename = new URL('../BrandingForm.vue', import.meta.url).pathname
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const transpile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText

const BRANDING = { primary_color: '#0055ff' } as unknown as Branding

// The card's script, compiled and run with the settings form stubbed to a plain draft, so the preset choice runs as wired.
function run(color: string) {
  const script = compileScript(descriptor, { id: 'BrandingForm' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const draft = Vue.ref<{ primary_color: string }>({ primary_color: color })
  const base = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, ApiError, buildBrandingPatch, normalizeHex, DEFAULT_COMPANY_COLOR: '#14102a',
    useI18n: () => ({ t: (key: string) => key }), useToast: () => ({ add: vi.fn() }), useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: () => true }), useUpdateBranding: () => ({ mutateAsync: vi.fn() }), useBrandingAdmin: () => ({ refetch: vi.fn() }),
    useSettingsForm: () => ({ draft, state: Vue.ref({ saving: false, reloading: false }), save: vi.fn(), revert: vi.fn(), reload: vi.fn() }),
  }
  const component = new Function(...Object.keys(base), transpile(script))(...Object.values(base))
  const scope = Vue.effectScope()
  const state = Vue.proxyRefs(scope.run(() => component.setup({ branding: BRANDING }, { expose: () => {}, emit: () => {} })))
  return { state, draft, stop: () => scope.stop() }
}

async function renderHtml(color: string) {
  const card = run(color)
  const compiled = compileTemplate({
    source: descriptor.template!.content, filename, id: 'BrandingForm', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  const render = new Function('Vue', transpile(compiled.code))(Vue) as (props: Record<string, unknown>, cache: number) => unknown
  const app = Vue.createSSRApp(Vue.defineComponent({
    setup: () => ({ ...Object.fromEntries(Object.entries(card.state).filter(([key]) => !key.startsWith('$'))) }),
    render: render as never,
  }))
  for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]!))) {
    app.component(name, Vue.defineComponent({ inheritAttrs: false, setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) }))
  }
  const html = await renderToString(app)
  card.stop()
  return html
}

afterEach(() => vi.unstubAllGlobals())

const radios = (html: string) => [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map(match => match[0])

describe('BrandingForm: the presets are one choice', () => {
  it('renders a radiogroup of four radios named by their colour, with the matching one checked and tabbable', async () => {
    const html = await renderHtml('#0055ff')
    expect(html).toContain('role="radiogroup"')
    const buttons = radios(html)
    expect(buttons).toHaveLength(4)
    expect(buttons.filter(button => button.includes('aria-checked="true"'))).toHaveLength(1)
    expect(buttons.find(button => button.includes('aria-checked="true"'))).toContain('aria-label="settings.branding.presets.blue"')
    expect(buttons.filter(button => button.includes('tabindex="0"'))).toHaveLength(1)
    expect(buttons.find(button => button.includes('tabindex="0"'))).toContain('aria-checked="true"')
    expect(html).not.toContain('aria-pressed')
  })

  it('checks no radio for a typed colour and keeps the first one in the tab order', async () => {
    const buttons = radios(await renderHtml('#123456'))
    expect(buttons.filter(button => button.includes('aria-checked="true"'))).toHaveLength(0)
    expect(buttons[0]).toContain('tabindex="0"')
    expect(buttons.slice(1).every(button => button.includes('tabindex="-1"'))).toBe(true)
  })

  it('keeps the tooltip off the button, so its text is not added to the name as a description', async () => {
    const html = await renderHtml('#0055ff')
    expect(html).not.toMatch(/<button[^>]*role="radio"[^>]*aria-describedby/)
  })

  it('moves the choice by what the eye sees: ArrowRight is the previous radio in a right-to-left row', () => {
    vi.stubGlobal('getComputedStyle', () => ({ direction: 'rtl' }))
    const { state, draft, stop } = run('#0055ff')
    const focus = vi.fn()
    state.presetGroup = { querySelectorAll: () => [{ focus }, { focus }, { focus }, { focus }] }
    const press = (key: string, index: number) => {
      const event = { key, preventDefault: vi.fn() } as unknown as KeyboardEvent
      ;(state.onPresetKey as (event: KeyboardEvent, index: number) => void)(event, index)
      return event
    }
    expect(press('ArrowRight', 1).preventDefault).toHaveBeenCalled()
    expect(draft.value.primary_color).toBe('#14102a')
    press('ArrowLeft', 1)
    expect(draft.value.primary_color).toBe('#0f766e')
    press('ArrowRight', 0)
    expect(draft.value.primary_color).toBe('#b45309')
    expect(focus).toHaveBeenCalledTimes(3)
    expect(press('Tab', 1).preventDefault).not.toHaveBeenCalled()
    stop()
  })
})
