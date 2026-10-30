import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transform } from 'esbuild'
import { expect, it } from 'vitest'

async function config(env: Record<string, string>) {
  const source = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
  const { code } = await transform(source, { loader: 'ts', format: 'cjs', define: { 'import.meta.url': JSON.stringify(new URL('../nuxt.config.ts', import.meta.url).href) } })
  const context = {
    module: { exports: {} as any },
    process: { env },
    URL,
    defineNuxtConfig: (value: unknown) => value,
    require: (name: string) => name === 'node:url'
      ? { fileURLToPath: () => '/unused/locales' }
      : { discoverLocaleFiles: () => ({ ar: [], en: [] }) },
  }
  runInNewContext(code, context)
  return context.module.exports.default
}

it.each([
  ['http://127.0.0.1:8217', 'ws://127.0.0.1:8217/websocket'],
  ['https://odoo.example.test', 'wss://odoo.example.test/websocket'],
])('dedicated dev WebSocket follows the configured backend %s', async (backend, websocket) => {
  const actual = await config({ NUXT_ODOO_URL: backend, NODE_ENV: 'development' })
  expect(actual.nitro.devProxy['/websocket'].target).toBe(websocket)
  expect(actual.runtimeConfig.public.wsUrl).toBe(websocket)
})

it('keeps explicit direct WS configuration while using backend URL for same-origin proxy', async () => {
  const actual = await config({ NUXT_ODOO_URL: 'http://127.0.0.1:8217', NUXT_PUBLIC_WS_URL: 'ws://localhost:8217/websocket', NODE_ENV: 'development' })
  expect(actual.nitro.devProxy['/websocket'].target).toBe('ws://127.0.0.1:8217/websocket')
  expect(actual.runtimeConfig.public.wsUrl).toBe('ws://localhost:8217/websocket')
})

it('keeps shared WebSocket on its edge and production dedicated same-origin by default', async () => {
  const shared = await config({ LIWAN_TENANCY_MODE: 'shared', NODE_ENV: 'development' })
  expect(shared.nitro.devProxy).toBeUndefined()
  expect(shared.runtimeConfig.public.wsUrl).toBe('')
  expect((await config({ NODE_ENV: 'production' })).runtimeConfig.public.wsUrl).toBe('')
})
