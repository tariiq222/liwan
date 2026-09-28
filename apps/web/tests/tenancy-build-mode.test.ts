import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transform } from 'esbuild'
import { createApp, eventHandler } from 'h3'
import { fetchNodeRequestHandler } from 'node-mock-http'
import { expect, it, vi } from 'vitest'

async function load(built: string, runtime: string | undefined) {
  const source = readFileSync(new URL('../server/plugins/tenancy-build-mode.ts', import.meta.url), 'utf8')
  const { code } = await transform(source, { loader: 'ts', format: 'cjs', define: { __NASQ_BUILD_TENANCY_MODE__: JSON.stringify(built) } })
  const context = { module: { exports: {} as any }, process: { env: { NASQ_TENANCY_MODE: runtime, NUXT_NASQ_BUILD_TENANCY_MODE: runtime } }, defineNitroPlugin: (p: unknown) => p }
  runInNewContext(code, context)
  const hookCallbacks: Array<() => void> = []
  const original = vi.fn(async () => { for (const hook of hookCallbacks) { try { hook() } catch { /* Nitro captures and swallows */ } } })
  const app = createApp({ onRequest: original })
  const downstream = vi.fn(() => 'downstream')
  app.use(eventHandler(downstream))
  context.module.exports.default({ h3App: app, hooks: { hook: (_name: string, fn: () => void) => hookCallbacks.push(fn) } })
  return { app, original, downstream, context }
}
it.each(['dedicated', 'shared'])('matching %s reaches H3 downstream, mutation cannot', async (mode) => {
  const { app, original, downstream, context } = await load(mode, mode)
  // Real H3 dispatch, not a direct invocation of a throw-only hook.
  const { toNodeListener } = await import('h3')
  expect(await (await fetchNodeRequestHandler(toNodeListener(app), '/web/test')).text()).toBe('downstream')
  expect(original).toHaveBeenCalledTimes(1)
  expect(original.mock.contexts[0]).toBe(app.options)
  expect(original.mock.calls[0]).toHaveLength(1)
  context.process.env.NASQ_TENANCY_MODE = mode === 'shared' ? 'dedicated' : 'shared'
  const denied = await fetchNodeRequestHandler(toNodeListener(app), '/web/test')
  expect(denied.status).toBe(500)
  expect(downstream).toHaveBeenCalledTimes(1)
  expect(original).toHaveBeenCalledTimes(1)
})
it.each([['dedicated', 'shared'], ['shared', 'dedicated'], ['shared', undefined], ['dedicated', 'invalid'], ['invalid', 'invalid']])('rejects built=%s runtime=%s at startup', async (built, runtime) => {
  await expect(load(built!, runtime)).rejects.toThrow('tenancy_build_runtime_mismatch')
})
it('preserves unset dedicated default', async () => {
  expect((await load('dedicated', undefined)).app.options.onRequest).toBeTypeOf('function')
})
