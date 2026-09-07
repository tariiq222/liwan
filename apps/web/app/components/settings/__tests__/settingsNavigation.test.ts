import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../SettingsTabs.vue')
const source = readFileSync(filename, 'utf8')
const parsed = parse(source, { filename })
if (!parsed.descriptor.scriptSetup) throw new Error('no script')
if (!parsed.descriptor.template) throw new Error('no template')

const scriptBody = ts.transpileModule(
  parsed.descriptor.scriptSetup.content.replace(
    /const \{ sections = \[\] \} = defineProps[\s\S]*?\(\)/,
    'const { sections = [] } = props',
  ),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
).outputText

const compiled = compileTemplate({
  source: parsed.descriptor.template.content,
  filename,
  id: 'settings-tabs',
  compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
})
const render = new Function('Vue', ts.transpileModule(compiled.code, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText)(Vue) as RenderFunction

function runSetup(
  props: { sections?: { id: string; label: string }[] },
  route: { path: string; query: Record<string, string>; hash: string },
  router = { replace: vi.fn() },
) {
  Object.assign(globalThis, { window: { location: { hash: route.hash }, addEventListener() {}, removeEventListener() {} } })
  return new Function(
    'Vue',
    'props',
    'useRoute',
    'useRouter',
    'useI18n',
    'useEventListener',
    'onMounted',
    `const { ref, computed } = Vue;\n${scriptBody}\nreturn { sections, t, isCurrent, go };`,
  )(
    Vue,
    props,
    () => route,
    () => router,
    () => ({ t: (key: string) => key === 'settings.toc.label' ? 'On this page' : key }),
    () => {},
    () => {},
  ) as { sections: { id: string; label: string }[]; t: (key: string) => string; isCurrent: (id: string, index: number) => boolean; go: (id: string, event: Event) => void }
}

async function renderTabs(route: { path: string; query: Record<string, string>; hash: string }, sections: { id: string; label: string }[]) {
  const bindings = runSetup({ sections }, route)
  const app = createSSRApp({
    render: () => h(defineComponent({ setup: () => bindings, render })),
  })
  return renderToString(app)
}

const sections = [
  { id: 'appearance-mode', label: 'Display mode' },
  { id: 'appearance-font', label: 'Font size' },
  { id: 'branding', label: 'Primary color' },
]

describe('SettingsTabs production script', () => {
  it('renders nothing when sections are empty', async () => {
    const html = await renderTabs({ path: '/settings/appearance', query: {}, hash: '' }, [])
    expect(html).not.toContain('nasq-settings-nav')
  })

  it('renders section labels and hash hrefs', async () => {
    const html = await renderTabs({ path: '/settings/appearance', query: {}, hash: '' }, sections)
    expect(html).toContain('aria-label="On this page"')
    expect(html).toContain('href="#appearance-mode"')
    expect(html).toContain('Display mode')
  })

  it('marks the first section current when the hash is empty', async () => {
    const html = await renderTabs({ path: '/settings/appearance', query: {}, hash: '' }, sections)
    expect(html).toMatch(/href="#appearance-mode"[^>]*aria-current="location"/)
    expect(html).not.toMatch(/href="#appearance-font"[^>]*aria-current/)
  })

  it('marks the hashed section current', async () => {
    const html = await renderTabs({ path: '/settings/appearance', query: {}, hash: '#branding' }, sections)
    expect(html).toMatch(/href="#branding"[^>]*aria-current="location"/)
    expect(html).not.toMatch(/href="#appearance-mode"[^>]*aria-current/)
  })

  it('keeps path and list query when moving the hash', () => {
    const replace = vi.fn()
    const route = { path: '/settings/users', query: { q: 'sara', status: 'active', offset: '25' }, hash: '' }
    const { go } = runSetup({ sections: [{ id: 'results', label: 'Results' }] }, route, { replace })
    go('results', { preventDefault() {} } as Event)
    expect(replace).toHaveBeenCalledWith({
      path: '/settings/users',
      query: { q: 'sara', status: 'active', offset: '25' },
      hash: '#results',
    })
  })
})
