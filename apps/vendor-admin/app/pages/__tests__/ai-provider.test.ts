import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(resolve(import.meta.dirname, '../ai-provider.vue'), 'utf8')

describe('AI provider page', () => {
  it('is gated on the AI capability', () => {
    expect(page).toContain("capability: 'vendor.ai.manage'")
  })

  it('warns, once a test has passed, when the provider returned no token counts', () => {
    const alert = page.slice(page.indexOf('data-testid="ai-provider-no-usage"') - 400, page.indexOf('data-testid="ai-provider-no-usage"'))
    expect(alert).toMatch(/tested && testResult\?\.ok && !testResult\.usage_reported/)
    expect(alert).toContain("aiProvider.form.noUsageTitle")
  })

  it('offers the token-count option only for a preset that lets the vendor choose it', () => {
    expect(page).toMatch(/v-if="preset\.stream_usage_editable"[^>]*>\s*<UCheckbox v-model="draft\.stream_usage"/)
  })

  it('says that only the Ollama preset may use a private address', () => {
    expect(page).toContain("preset.provider === 'ollama' ? 'aiProvider.form.baseUrlHintPrivate' : 'aiProvider.form.baseUrlHintPublic'")
  })

  it('cannot save before a passing test of the current values', () => {
    expect(page).toContain(':disabled="!hydrated || Boolean(busy) || !tested"')
    expect(page).toContain('testSignature(draft)')
  })
})
