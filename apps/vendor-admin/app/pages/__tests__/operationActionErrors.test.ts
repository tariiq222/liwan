import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { canAbandonJob } from '../../utils/sharedJobAbandon'
import { canRecoverJob } from '../../utils/sharedJobRecovery'

// The mounting harness of aiBillingSettings.test.ts: the page's script only; the template forwards what the script exposes.
const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')

const job = { id: 'j-1', tenant_id: 't-1', source: 'shared', type: 'backup', status: 'needs_intervention', stage: 'failed', updated_at: '2026-11-21T10:00:00Z', events: [] }

async function page(failing: string) {
  const filename = resolve(import.meta.dirname, '../operations/[id].vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'operation' }).content).replaceAll('import.meta.client', 'false').replace('export default', 'return')
  const request = vi.fn(async (path: string, init?: { method?: string }) => {
    if (init?.method === 'POST' && path.endsWith(failing)) throw { statusCode: 422, data: { code: 'invalid' } }
    return job
  })
  const bindings = {
    canAbandonJob, canRecoverJob, formatLiwanDateTime: String, operationStatusBadge: () => ({}), canPublishRestore: () => false, operationTargetTo: () => null, safeReturnTo: () => '/operations',
    failureKey: (cause: { data?: { code?: string } }, fallback: string) => cause?.data?.code ?? fallback,
    _defineComponent: Vue.defineComponent, _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, onMounted: () => {}, onBeforeUnmount: () => {},
    definePageMeta: () => {}, useHydrated: () => Vue.ref(true), useI18n: () => ({ t: (key: string) => key }), useRoute: () => ({ params: { id: 'j-1' }, query: { source: 'shared' } }),
    useVendorContext: () => ({ can: () => true }), useVendorApi: () => ({ request }), navigateTo: async () => {},
    useAsyncData: async (_key: unknown, fn: () => Promise<unknown>) => {
      const data = Vue.ref<unknown>(null); const error = Vue.ref<unknown>(null); const pending = Vue.ref(false)
      const refresh = async () => { data.value = await fn() }
      await refresh()
      return { data, error, pending, refresh }
    },
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const state = await Vue.effectScope().run(() => component.setup({}, { expose: () => {} }))
  return state
}

describe('operation page action errors', () => {
  it('shows a failed recover under the recover section only, not under abandon or retry', async () => {
    const state = await page('/recover')
    state.recoverReason.value = 'Provisioning stuck'
    await state.recoverJob()
    expect(state.errorKeyOf('recover')).toBe('invalid')
    expect(state.errorKeyOf('abandon')).toBeNull()
    expect(state.errorKeyOf('retry')).toBeNull()
    expect(state.errorKeyOf('publish')).toBeNull()
  })

  it('shows a failed abandon under the abandon section only, and a new action clears the old error', async () => {
    const state = await page('/abandon')
    state.abandonReason.value = 'Nothing left to recover'
    await state.abandonJob()
    expect(state.errorKeyOf('abandon')).toBe('invalid')
    expect(state.errorKeyOf('recover')).toBeNull()
    state.recoverReason.value = 'Try again'
    await state.recoverJob()
    expect(state.errorKeyOf('abandon')).toBeNull()
  })
})
