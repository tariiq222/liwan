/** Startup uses local operator files only. Never calls a vendor registry. */
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createDedicatedGuard, readLocalBinding } from './dedicated_guard.mjs'
import { validateAssetStore } from '../../apps/web/server/utils/releaseAssets.ts'

export function loadDedicatedConfig(env = process.env) {
  const bindingPath = env.WEBVUE_DEDICATED_BINDING_PATH
  const releaseRoutesDir = env.WEBVUE_RELEASE_ROUTES_DIR
  readLocalBinding(bindingPath)
  if (!releaseRoutesDir || realpathSync(releaseRoutesDir) !== releaseRoutesDir || !lstatSync(releaseRoutesDir).isDirectory()) throw Error('dedicated_release_config_rejected')
  let proxyToken = env.WEBVUE_DEDICATED_PROXY_TOKEN
  if (env.WEBVUE_DEDICATED_PROXY_TOKEN_FILE) {
    if (proxyToken !== undefined) throw Error('dedicated_release_config_rejected')
    const path = env.WEBVUE_DEDICATED_PROXY_TOKEN_FILE
    const info = lstatSync(path)
    if (realpathSync(path) !== path || !info.isFile() || info.isSymbolicLink() || info.size > 4096 || ![0o400, 0o440, 0o600].includes(info.mode & 0o777)) throw Error('dedicated_release_config_rejected')
    proxyToken = readFileSync(path, 'utf8').trim()
  }
  if (typeof proxyToken !== 'string' || Buffer.byteLength(proxyToken) < 32) throw Error('dedicated_release_config_rejected')
  const trustedEdgeAddresses = env.WEBVUE_DEDICATED_TRUSTED_EDGE_IPS?.split(',').map(value => value.trim())
  const releaseAssetsDir = env.WEBVUE_RELEASE_ASSETS_DIR
  if (releaseAssetsDir !== undefined) validateAssetStore(releaseAssetsDir)
  return { bindingPath, releaseRoutesDir, proxyToken, ...(trustedEdgeAddresses ? { trustedEdgeAddresses } : {}), publicProto: env.WEBVUE_DEDICATED_PUBLIC_PROTO ?? 'https', ...(releaseAssetsDir !== undefined ? { releaseAssetsDir } : {}) }
}
export function startDedicated(env = process.env) {
  const config = loadDedicatedConfig(env)
  const port = Number(env.WEBVUE_DEDICATED_GUARD_PORT ?? 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('dedicated_release_config_rejected')
  const server = createDedicatedGuard(config)
  server.listen(port, '0.0.0.0')
  const drain = () => server.close() // Existing request/WS leases remain until their actual completion.
  process.once('SIGTERM', drain); process.once('SIGINT', drain)
  return server
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { startDedicated() } catch { console.error('dedicated_release_start_rejected'); process.exitCode = 1 }
}
