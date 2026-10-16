import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(import.meta.dirname, '../../..')
const page = readFileSync(resolve(webRoot, 'app/components/vendor/TenantOperationsPanel.vue'), 'utf8')
const en = JSON.parse(readFileSync(resolve(webRoot, 'i18n/locales/en/vendor.json'), 'utf8'))
const ar = JSON.parse(readFileSync(resolve(webRoot, 'i18n/locales/ar/vendor.json'), 'utf8'))

describe('vendor tenant available operations contract', () => {
  it('renders only operations explicitly provided by the server', () => {
    expect(page).toContain('available_operations')
    expect(page).toMatch(/operationTypes\s*=\s*computed\([\s\S]*?availableOperations\.value\.map/)
    expect(page).toMatch(/availableOperations[\s\S]*?Array\.isArray/)
    expect(page).toMatch(/availableOperations[\s\S]*?every\(/)
    expect(page).toMatch(/availableOperations[\s\S]*?tenant\.create[\s\S]*?tenant\.inspect[\s\S]*?health[\s\S]*?backup[\s\S]*?tenant\.entitle/)
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
