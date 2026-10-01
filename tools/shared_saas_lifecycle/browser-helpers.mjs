import https from 'node:https'
import { expect } from '@playwright/test'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
export const here = dirname(fileURLToPath(import.meta.url))
export const state = JSON.parse(await readFile(join(here, '.state/current.json'), 'utf8'))
export async function acceptedPair() {
  const root = join(state.stateDir, 'evidence'), found = []
  for (const entry of (await readdir(root)).filter(x => x.startsWith('browser-')).sort()) {
    const path = join(root, entry, 'first-tenant.json')
    const text = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (text === null) continue // Interrupted runner may have created only its evidence directory.
    const proof = JSON.parse(text)
    if (proof.checkpoints.some(s => s.name === 'milestone-one-accepted')) found.push({ ...proof, evidencePath: path })
  }
  if (found.length < 2) throw new Error('Two accepted browser-created tenants required')
  const registry = JSON.parse(await readFile(join(state.stateDir, 'registry/registry.json'), 'utf8'))
  return Promise.all(found.slice(-2).map(async proof => {
    const binding = registry.targets.find(t => t.host === proof.tenant.host)
    if (!binding?.enabled) throw new Error('Accepted source is not enabled')
    const credentials = JSON.parse(await readFile(join(state.stateDir, 'credentials', `${binding.database}.json`), 'utf8'))
    return { ...proof, binding, credentials, origin: `https://${binding.host}` }
  }))
}
export async function login(page, origin, credentials) {
  await page.goto(`${origin}/login`)
  await page.getByLabel('اسم المستخدم', { exact: true }).fill(credentials.login)
  await page.getByLabel('كلمة المرور', { exact: true }).fill(credentials.password)
  const submit = page.getByRole('button', { name: 'دخول', exact: true })
  await expect(submit).toBeEnabled(); await submit.click()
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}
export async function browserFetch(page, path, options = {}) {
  return page.evaluate(async ({ path, options }) => {
    const r = await fetch(path, options)
    return { status: r.status, text: await r.text() }
  }, { path, options })
}

export async function edge(host, path, cookie, extra = {}) {
  const ca = await readFile('/tmp/nasq-saas-lifecycle-ca.pem')
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', port: 443, servername: host, path, ca,
      headers: { host, ...(cookie ? { cookie } : {}), ...extra } }, response => {
      const chunks = []; response.on('data', b => chunks.push(b))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject); req.end()
  })
}
