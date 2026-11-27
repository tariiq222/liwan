import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'

const webRoot = resolve(import.meta.dirname, '../../..')
const panelPath = resolve(webRoot, 'app/components/vendor/TenantOperationsPanel.vue')
const page = readFileSync(panelPath, 'utf8')
const en = JSON.parse(readFileSync(resolve(webRoot, 'i18n/locales/en/vendor.json'), 'utf8'))
const ar = JSON.parse(readFileSync(resolve(webRoot, 'i18n/locales/ar/vendor.json'), 'utf8'))

const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const scopes: Vue.EffectScope[] = []
afterEach(() => scopes.splice(0).forEach(s => s.stop()))

function mountPanelState(availableOperationsInput: unknown) {
  const descriptor = parse(page, { filename: panelPath }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'tenant-operations-panel' }).content).replace('export default', 'return')
  const tenantData = Vue.ref<Record<string, unknown>>({
    id: 't-1',
    operations_enabled: true,
    hosting_model: 'dedicated',
    available_operations: availableOperationsInput,
  })
  const bindings = {
    _defineComponent: Vue.defineComponent,
    _useModel: () => Vue.ref(false),
    _mergeModels: (a: Record<string, unknown>, b: Record<string, unknown>) => ({ ...a, ...b }),
    computed: Vue.computed,
    ref: Vue.ref,
    reactive: Vue.reactive,
    toRef: Vue.toRef,
    watch: Vue.watch,
    onBeforeUnmount: () => {},
    useI18n: () => ({ t: (key: string) => key, te: () => true }),
    useVendorApi: () => ({ request: vi.fn() }),
    useVendorContext: () => ({ can: () => true }),
    useVendorTenant: () => ({ data: tenantData, error: Vue.ref(null), pending: Vue.ref(false), refresh: vi.fn() }),
    useVendorCatalogVersions: () => ({ load: () => ({ data: Vue.ref([]) }) }),
    useTenantRecentOperations: () => ({ data: Vue.ref([]), error: Vue.ref(null), pending: Vue.ref(false), refresh: vi.fn() }),
    formatBusinessDateTime: (v: string) => v,
    operationStatusBadge: () => ({ tone: 'neutral', labelKey: '' }),
    buildVendorPolicy: () => ({}),
    showsSharedBackups: () => false,
    failureKey: (_cause: unknown, fallback: string) => fallback,
    keyLabel: (key: string) => key,
    navigateTo: vi.fn(),
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope()
  scopes.push(scope)
  return scope.run(() => component.setup({ tenantId: 't-1', dirty: false }, { expose: () => {}, emit: () => {} }))
}

describe('vendor tenant available operations contract', () => {
  it('renders only operations explicitly provided by the server', () => {
    expect(page).toContain('available_operations')
    expect(page).toMatch(/operationTypes\s*=\s*computed\([\s\S]*?availableOperations\.value\.map/)
    expect(page).toMatch(/availableOperations[\s\S]*?Array\.isArray/)
    expect(page).toMatch(/availableOperations[\s\S]*?filter\(/)
    expect(page).toMatch(/availableOperations[\s\S]*?tenant\.create[\s\S]*?tenant\.inspect[\s\S]*?health[\s\S]*?backup[\s\S]*?tenant\.entitle/)
  })

  it('keeps known operations and ignores unknown ones advertised by the server', () => {
    const state = mountPanelState(['health', 'upgrade', 'backup', 'health'])
    expect(state.availableOperations.value).toEqual(['health', 'backup'])
    expect(state.operationTypes.value.map((item: { value: string }) => item.value)).toEqual(['health', 'backup'])
    expect(mountPanelState(['upgrade']).availableOperations.value).toEqual([])
    expect(mountPanelState(null).availableOperations.value).toEqual([])
  })

  it('fails closed for a missing or malformed server operation list', () => {
    expect(page).toMatch(/available_operations[\s\S]*?Array\.isArray[\s\S]*?return\s*\[\]/)
    expect(page).toContain('operationsUnavailableHint')
    expect(en.vendor.tenants.operationsUnavailableHint).toMatch(/unavailable|refresh/i)
    expect(ar.vendor.tenants.operationsUnavailableHint).toMatch(/تعذّر|حدّث/)
    expect(page).toMatch(/!availableOperations\.length/)
  })

  it('does not infer operation availability from status, inventory target, or hosting model', () => {
    expect(page).not.toMatch(/data\.value\?\.status\s*===\s*'registered'\s*\?\s*'tenant\.create'/)
    expect(page).not.toMatch(/inventory_target.*startsWith|hosting_model.*managed.*operationTypes/)
  })

  it('clears stale availability and refreshes tenant detail after the grant response', () => {
    expect(page).toMatch(/data\.value = \{ \.\.\.data\.value, available_operations: undefined \}[\s\S]*?operations-grant[\s\S]*?await refresh\(\)/)
  })

  it('prevents enqueues unless the selected operation remains in the server list', () => {
    expect(page).toMatch(/async function enqueueOperation\(\)[\s\S]*?operationTypes\.value\.some\(operation => operation\.value === actionType\.value\)\) return/)
  })
})
