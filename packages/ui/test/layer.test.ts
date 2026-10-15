import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('ui layer', () => {
  it('registers its stylesheet and ships the fonts', async () => {
    vi.stubGlobal('defineNuxtConfig', (config: unknown) => config)
    const { default: config } = await import('../nuxt.config') as { default: { css: string[] } }
    const main = join(root, 'app/assets/css/main.css')
    expect(config.css).toContain(main)
    expect(existsSync(main)).toBe(true)
    expect(existsSync(join(root, 'public/fonts/IBMPlexSansArabic-Regular.woff2'))).toBe(true)
  })
})
