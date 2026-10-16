import { resolve } from 'node:path'

const layerRoot = resolve(import.meta.dirname, '../..')

/** Absolute path of a file inside the ui layer, for tests in other packages that read layer sources. */
export function layerFile(relativePath: string): string {
  return resolve(layerRoot, relativePath)
}
