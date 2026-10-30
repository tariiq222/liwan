import { timingSafeEqual } from 'node:crypto'
import { readdirSync, lstatSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createError, getHeader, type H3Event } from 'h3'

/** A private read-only candidate probe; supplies no tenant or business access. */
export function releaseProbeRequest(event: H3Event): boolean {
  if (event.path.split('?')[0] !== '/_liwan/release-readiness') return false
  const token = process.env.LIWAN_RELEASE_PROBE_TOKEN ?? ''
  const supplied = getHeader(event, 'x-liwan-release-probe') ?? ''
  if (token.length < 32 || Buffer.byteLength(token) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied))) {
    throw createError({ statusCode: 403, message: 'release_probe_forbidden' })
  }
  return true
}
export function releaseReadiness(event: H3Event) {
  if (!releaseProbeRequest(event)) throw createError({ statusCode: 404 })
  const values = { releaseId: process.env.LIWAN_RELEASE_ID, poolId: process.env.LIWAN_RELEASE_POOL_ID, assetsId: process.env.LIWAN_ASSETS_ID, aiStateVersion: process.env.AI_STATE_VERSION ?? '1' }
  if (Object.values(values).some(value => !value || !/^[a-zA-Z0-9_-]{1,63}$/.test(value))) throw createError({ statusCode: 503, message: 'release_identity_missing' })
  const root = resolve(process.env.LIWAN_RELEASE_PUBLIC_DIR ?? '.output/public')
  if (realpathSync(root) !== root) throw createError({ statusCode: 503 })
  const directory = join(root, '_nuxt')
  const assets = readdirSync(directory).filter(name => /^[a-zA-Z0-9_.-]+\.js$/.test(name) && lstatSync(join(directory, name)).isFile()).slice(0, 3).map(name => `/_nuxt/${name}`)
  if (!assets.length) throw createError({ statusCode: 503, message: 'release_assets_missing' })
  const messages = join(root, '_i18n')
  const hashes = readdirSync(messages).filter(name => /^[a-f0-9]{8,64}$/.test(name))
  for (const locale of ['ar', 'en']) {
    const paths = hashes.map(hash => join(messages, hash, locale, 'messages.json')).filter(path => {
      try { return realpathSync(path) === path && lstatSync(path).isFile() } catch { return false }
    })
    if (paths.length !== 1) throw createError({ statusCode: 503, message: 'release_messages_missing' })
    assets.push(paths[0]!.slice(root.length))
  }
  return { ...values, assets }
}
