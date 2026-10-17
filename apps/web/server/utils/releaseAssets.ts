/** Read append-only public release assets after tenant/route admission. */
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const hash = /^(?:[A-Za-z0-9_-]{8}|[a-f0-9]{10,64})$/
const component = /^[A-Za-z0-9_.-]+$/
const fontTypes: Record<string, string> = { woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' }
const mime: Record<string, string> = { js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', ...fontTypes }

export function validateAssetStore(root: string): string {
  if (!root || resolve(root) !== root || realpathSync(root) !== root || !lstatSync(root).isDirectory()) throw Error('release_asset_store_rejected')
  return root
}
/** Detect encoded aliases too, so they receive 404 rather than active-web fallback. */
export function isReleaseAssetRequest(path: string): boolean {
  let value = path.split('?')[0] ?? ''
  // These exact stable public paths are intentionally served by the selected web.
  if (['/_nuxt/builds/latest.json', '/fonts/LICENSE.txt'].includes(value)) return false
  for (let depth = 0; depth < 4; depth++) {
    if (/^\/(?:_nuxt|_i18n|fonts)(?:[/\\]|$)/.test(value)) return true
    try { const decoded = decodeURIComponent(value); if (decoded === value) break; value = decoded } catch { break }
  }
  return false
}
function kind(parts: string[]): { type: string; immutable: boolean } | null {
  const name = parts.at(-1) ?? '', extension = (name.split('.').at(-1) ?? '').toLowerCase()
  if (parts[0] === 'fonts' && fontTypes[extension]) return { type: fontTypes[extension]!, immutable: false }
  if (!['_nuxt', '_i18n'].includes(parts[0] ?? '')) return null
  if (parts.length === 4 && parts.slice(0, 3).join('/') === '_nuxt/builds/meta' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(name)) return { type: mime.json!, immutable: true }
  const stem = name.slice(0, -(extension.length + 1))
  const filenameHashed = hash.test(stem.split('.').at(-1) ?? '')
  const ancestorHashed = parts.slice(1, -1).some(part => hash.test(part))
  if (['js', 'mjs', 'css'].includes(extension) && filenameHashed) return { type: mime[extension]!, immutable: true }
  if (extension === 'json' && (filenameHashed || ancestorHashed) && parts.join('/').toLowerCase().includes('i18n')) return { type: mime.json!, immutable: true }
  return null
}
export function readAsset(root: string, requestPath: string): { body: Buffer; headers: Record<string, string> } | null {
  let descriptor: number | undefined
  try {
    validateAssetStore(root)
    const path = requestPath.split('?')[0] ?? ''
    if (!path.startsWith('/') || path.startsWith('//') || /[%\\#\r\n]/.test(requestPath)) return null
    const parts = path.slice(1).split('/')
    if (parts.length < 2 || parts.some(part => !part || part === '.' || part === '..' || !component.test(part))) return null
    const asset = kind(parts)
    if (!asset) return null
    let parent = root
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part)
      const info = lstatSync(parent)
      if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(parent) !== parent) return null
    }
    const filename = join(parent, parts.at(-1)!)
    descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = fstatSync(descriptor)
    if (!info.isFile() || info.size > 64 * 1024 * 1024) return null
    const body = readFileSync(descriptor)
    return { body, headers: { 'content-type': asset.type, 'content-length': String(body.length),
      'cache-control': asset.immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
      'x-content-type-options': 'nosniff', etag: '"' + createHash('sha256').update(body).digest('hex') + '"' } }
  } catch { return null }
  finally { if (descriptor !== undefined) closeSync(descriptor) }
}
