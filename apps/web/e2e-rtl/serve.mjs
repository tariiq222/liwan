// Minimal static server for storybook-static (python's http.server drops connections under parallel load).
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'storybook-static')
const port = Number(process.argv[3] ?? 6007)
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff',
}

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
  const file = join(root, path.endsWith('/') ? `${path}index.html` : path)
  if (!file.startsWith(root)) { res.writeHead(403).end(); return }
  try {
    if (!statSync(file).isFile()) throw new Error('not a file')
  } catch {
    res.writeHead(404).end(); return
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => process.stdout.write(`serving ${root} on ${port}\n`))
