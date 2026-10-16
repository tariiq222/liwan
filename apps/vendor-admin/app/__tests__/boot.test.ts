import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

async function loadConfig(): Promise<Record<string, any>> {
  return (await import('../../nuxt.config') as { default: Record<string, any> }).default
}

describe('vendor admin scaffold', () => {
  it('extends the shared ui layer and renders on the server', async () => {
    const config = await loadConfig()
    expect(config.extends).toContain('@webvue/ui')
    expect(config.ssr).not.toBe(false)
    expect(config.devServer.port).toBe(3100)
  })

  it('registers Arabic-first i18n without a locale prefix', async () => {
    const { i18n } = await loadConfig()
    expect(i18n.defaultLocale).toBe('ar')
    expect(i18n.strategy).toBe('no_prefix')
    expect(i18n.locales.map((l: { code: string, dir: string }) => [l.code, l.dir])).toEqual([['ar', 'rtl'], ['en', 'ltr']])
  })

  it('keeps every BFF setting private and empty by default', async () => {
    const { runtimeConfig } = await loadConfig()
    const { public: publicConfig, ...privateConfig } = runtimeConfig
    expect(privateConfig).toEqual({ controlUrl: '', serviceKey: '', installationId: '', adminOrigin: '', trustProxy: false })
    expect(publicConfig).toEqual({ devLogin: false })
    expect(JSON.stringify(publicConfig ?? {})).not.toMatch(/key|control/i)
  })

  it('sets the security headers and never caches the API', async () => {
    const { routeRules } = await loadConfig()
    expect(routeRules['/**'].headers).toMatchObject({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
    expect(routeRules['/api/**'].headers['Cache-Control']).toBe('no-store')
  })

  it('bundles the lucide icons offline', async () => {
    const { icon } = await loadConfig()
    expect(icon).toMatchObject({ provider: 'none', fallbackToApi: false })
    expect(icon.clientBundle.scan).toBeTruthy()
  })

  it('wraps the app in UApp with the i18n locale', () => {
    const app = readFileSync(`${root}app/app.vue`, 'utf8')
    expect(app).toContain('<UApp')
    expect(app).toMatch(/locale === 'ar' \? ar : en/)
    expect(app).toContain('useLocaleHead')
  })
})
