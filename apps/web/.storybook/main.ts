import type { StorybookConfig } from '@storybook/vue3-vite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { buildNuxtImports } from './nuxt-imports.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')

// nuxt.config.ts and app.config.ts are read as-is; their define* helpers are identity functions.
const configGlobals = globalThis as { defineNuxtConfig?: (c: unknown) => unknown; defineAppConfig?: (c: unknown) => unknown }
configGlobals.defineNuxtConfig ??= c => c
configGlobals.defineAppConfig ??= c => c

type LocaleConfig = { code: string; language: string; dir: 'rtl' | 'ltr'; files: string[] }

function i18nMessages(locales: LocaleConfig[]): Plugin {
  const id = 'virtual:nasq-i18n'
  return {
    name: 'nasq:i18n-messages',
    resolveId: source => (source === id ? `\0${id}` : undefined),
    load(source) {
      if (source !== `\0${id}`) return
      const imports: string[] = []
      const table: string[] = []
      locales.forEach((locale, li) => {
        const parts = locale.files.map((file, fi) => {
          const name = `m${li}_${fi}`
          imports.push(`import ${name} from ${JSON.stringify(join(webRoot, 'i18n/locales', file))}`)
          return name
        })
        table.push(`${JSON.stringify(locale.code)}: merge(${parts.join(', ')})`)
      })
      return `${imports.join('\n')}
function merge(...parts) { const out = {}; const deep = (t, s) => { for (const [k, v] of Object.entries(s)) { if (v && typeof v === 'object' && !Array.isArray(v)) deep(t[k] ??= {}, v); else t[k] = v } }; parts.forEach(p => deep(out, p)); return out }
export const locales = ${JSON.stringify(locales.map(({ code, language, dir }) => ({ code, language, dir })))}
export default { ${table.join(', ')} }`
    },
  }
}

const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.ts'],
  addons: ['@storybook/addon-docs', 'msw-storybook-addon'],
  framework: { name: '@storybook/vue3-vite', options: {} },
  staticDirs: ['../public', './public'],
  async viteFinal(viteConfig, { configType }) {
    const { mergeConfig } = await import('vite')
    const { default: nuxtConfig } = await import('../nuxt.config.ts') as { default: { ui: object; icon?: { clientBundle?: object }; i18n: { locales: LocaleConfig[] } } }
    const { default: appConfig } = await import('../app/app.config.ts') as { default: { ui: object } }
    const ui = (await import('@nuxt/ui/vite')).default
    const vue = (await import('@vitejs/plugin-vue')).default
    const { imports, components, report } = await buildNuxtImports()

    if (report.missing.length) {
      const message = `[nasq-storybook] app code calls Nuxt runtime APIs without a shim in .storybook/nuxt-shims.ts: ${report.missing.join(', ')}`
      if (configType === 'PRODUCTION') throw new Error(message)
      console.warn(message)
    }

    return mergeConfig(viteConfig, {
      resolve: { alias: { '~': join(webRoot, 'app'), '@': join(webRoot, 'app') } },
      define: { 'import.meta.server': 'false', 'import.meta.client': 'true', 'import.meta.dev': 'true' },
      plugins: [
        vue(),
        i18nMessages(nuxtConfig.i18n.locales),
        ui({
          ...nuxtConfig.ui,
          ui: appConfig.ui,
          icon: { clientBundle: nuxtConfig.icon?.clientBundle },
          dts: false,
          // buildNuxtImports is plain JS (no declared types); its shape already
          // matches unplugin-auto-import's InlinePreset[], so assert it here.
          autoImport: { imports: imports as { from: string, imports: string[] }[], dts: false, vueTemplate: true },
          components: {
            dts: false,
            dirs: [],
            resolvers: [(name: string) => (components as Record<string, { name: string; from: string }>)[name]],
          },
        }),
      ],
    })
  },
}

export default config
