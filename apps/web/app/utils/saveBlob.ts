const REVOKE_DELAY_MS = 10_000

/** Hands a downloaded blob to the browser as a file with the given name. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // The browser starts reading the blob after the click returns: revoke only afterwards.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
