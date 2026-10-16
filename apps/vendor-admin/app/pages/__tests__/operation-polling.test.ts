import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(import.meta.dirname, '../../..')
const page = readFileSync(resolve(webRoot, 'app/pages/operations/[id].vue'), 'utf8')
const en = JSON.parse(readFileSync(resolve(webRoot, 'i18n/locales/en/vendor.json'), 'utf8'))
const ar = JSON.parse(readFileSync(resolve(webRoot, 'i18n/locales/ar/vendor.json'), 'utf8'))

describe('vendor operation bounded polling UX', () => {
  it('exposes a truthful paused state after the automatic polling limit', () => {
    expect(page).toContain('pollingPaused')
    expect(page).toContain("vendor.operations.pollingPaused")
    expect(en.vendor.operations.pollingPaused).toMatch(/stopped|paused/i)
    expect(ar.vendor.operations.pollingPaused).toMatch(/توقف|متوقف/)
  })

  it('manual refresh resets the poll budget and restarts polling for active work', () => {
    expect(page).toContain('async function manualRefresh()')
    expect(page).toMatch(/pollCount\.value\s*=\s*0[\s\S]*?await refresh\(\)[\s\S]*?schedulePoll\(\)/)
    expect(page).toContain('@click="manualRefresh"')
  })

  it('does not change operation availability based on an unverified lane guess', () => {
    const tenantPage = readFileSync(resolve(webRoot, 'app/components/vendor/TenantOperationsPanel.vue'), 'utf8')
    expect(tenantPage).not.toMatch(/inventory_target.*startsWith|hosting_model.*managed.*operationTypes/)
  })
})
