import qrcode from 'qrcode-generator'

/** Empty modules around the code that scanners need (the QR specification asks for four). */
export const QR_QUIET_ZONE = 4

/** The side of the drawing in modules, quiet zone included, and the dark modules as one SVG path (one rectangle per run). */
export interface QrDrawing { size: number, path: string }

/** Draws an `otpauth://` link as a QR code. Runs in the browser only: the link carries the secret and goes nowhere. */
export function totpQr(uri: string): QrDrawing {
  if (!uri) throw new Error('The authenticator link is empty')
  const code = qrcode(0, 'M')
  code.addData(uri)
  code.make()
  const modules = code.getModuleCount()
  const runs: string[] = []
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!code.isDark(row, col)) continue
      const start = col
      while (col + 1 < modules && code.isDark(row, col + 1)) col++
      runs.push(`M${start + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h${col - start + 1}v1h-${col - start + 1}z`)
    }
  }
  return { size: modules + 2 * QR_QUIET_ZONE, path: runs.join('') }
}
