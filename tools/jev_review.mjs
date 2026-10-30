// Advisory quality signal: send a diff to the local jev-review MCP server and print its scores.
// Usage: node tools/jev_review.mjs [--base <ref> | --diff <file>] --task "<text>" [--previous <file>] [--json]
// Always exits 0: the scores are advisory, the local checks remain the gate.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CALL_TIMEOUT_MS = 180_000
const REPOSITORY_CONTEXT = [
  'LiwanOS: Odoo 19 Community addons (odoo-addons/liwan_*) as the engine and a Nuxt 4 customer UI (apps/web),',
  'zod contracts in packages/contracts. Rules live in AGENTS.md: architecture R1-R10 (applications never import',
  'each other, bridges link them), API routes are json2 + auth=user + api_handler with serializer whitelists and',
  '{items, total} list envelopes, no sudo() outside documented cases, Arabic/RTL-first UI through $t(),',
  'and a clean pre-release codebase: replace code in place, no parallel copies or schema remnants.',
].join(' ')

export function parseArgs(argv) {
  const args = { base: 'main', diff: null, task: null, previous: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--json') args.json = true
    else if (['--base', '--diff', '--task', '--previous'].includes(flag) && argv[i + 1] !== undefined) {
      args[flag.slice(2)] = argv[++i]
    } else throw new Error(`unknown or incomplete argument: ${flag}`)
  }
  if (!args.task) throw new Error('--task "<text>" is required')
  return args
}

// Every path the diff touches, old and new side, from its `diff --git a/X b/Y` headers.
export function diffPaths(diff) {
  const paths = new Set()
  for (const match of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    paths.add(match[1])
    paths.add(match[2])
  }
  return [...paths].sort()
}

// Added lines per file, so literal secrets can be checked the same way tools/secret_guard.py does.
export function addedLines(diff) {
  const byPath = {}
  let current = null
  for (const line of diff.split('\n')) {
    const header = line.match(/^\+\+\+ (?:b\/)?(.+)$/)
    if (header) {
      current = header[1] === '/dev/null' ? null : header[1]
      continue
    }
    if (current && line.startsWith('+')) (byPath[current] ??= []).push(line.slice(1))
  }
  return Object.fromEntries(Object.entries(byPath).map(([path, lines]) => [path, lines.join('\n')]))
}

const GUARD_SCRIPT = `
import json, sys
sys.path.insert(0, 'tools')
from secret_guard import (
    SCAN_ROOTS, SCANNED_SUFFIXES, JS_SUFFIXES,
    find_credential_fallbacks, find_forbidden_paths, find_secret_lines,
)
data = json.load(sys.stdin)
problems = [f'secret-bearing path: {p}' for p in find_forbidden_paths(data['paths'])]
for path, text in data['added'].items():
    if path.startswith(SCAN_ROOTS) and path.endswith(SCANNED_SUFFIXES):
        problems += [f'literal secret in added line {n}: {p}' for p, n in find_secret_lines(path, text)]
    if path.startswith(SCAN_ROOTS) and path.endswith(JS_SUFFIXES):
        problems += [f'credential fallback literal in added line {n}: {path}'
                     for n in find_credential_fallbacks(text, path)]
print(json.dumps(problems))
`

// Reasons to refuse sending, judged by tools/secret_guard.py itself so the rules have one owner.
export function secretProblems(diff) {
  const result = spawnSync('python3', ['-B', '-c', GUARD_SCRIPT], {
    cwd: ROOT,
    input: JSON.stringify({ paths: diffPaths(diff), added: addedLines(diff) }),
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`secret guard failed: ${result.stderr.trim()}`)
  return JSON.parse(result.stdout)
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout
}

// Committed and uncommitted tracked changes since the merge base with `base`.
function diffAgainst(base) {
  const mergeBase = git(['merge-base', base, 'HEAD']).trim()
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
  if (untracked.length) console.error(`note: ${untracked.length} untracked file(s) are not in the diff; git add them to include them`)
  return git(['diff', mergeBase])
}

function readApiKey() {
  const fromEnv = process.env.JEV_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const keyFile = join(homedir(), '.config', 'jev-review', 'api-key')
  try {
    return readFileSync(keyFile, 'utf8').trim()
  } catch {
    throw new Error(`no API key: set JEV_API_KEY or write it to ${keyFile}`)
  }
}

// Minimal MCP stdio client: initialize, then one tools/call of jev_review.
function callJevReview(input, apiKey) {
  const serverDir = process.env.JEV_REVIEW_DIR || join(homedir(), 'code', 'jev-review')
  const serverPath = join(serverDir, 'dist', 'server.js')
  if (!existsSync(serverPath)) return Promise.reject(new Error(`${serverPath} not found; set JEV_REVIEW_DIR`))
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, JEV_API_KEY: apiKey },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`no answer within ${CALL_TIMEOUT_MS / 1000}s`)), CALL_TIMEOUT_MS)
    function finish(error, value) {
      clearTimeout(timer)
      child.kill()
      error ? reject(error) : resolve(value)
    }
    child.on('error', (error) => finish(error))
    child.on('exit', (code) => finish(new Error(`jev-review server exited (${code}): ${stderr.trim()}`)))
    createInterface({ input: child.stdout }).on('line', (line) => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return // the server may log non-protocol lines
      }
      if (message.error) return finish(new Error(`MCP error: ${message.error.message}`))
      if (message.id === 1) {
        send({ method: 'notifications/initialized' })
        send({ id: 2, method: 'tools/call', params: { name: 'jev_review', arguments: input } })
      } else if (message.id === 2) {
        const { result } = message
        if (result.isError) return finish(new Error(result.content?.map((c) => c.text).join('\n') || 'jev_review failed'))
        finish(null, result.structuredContent ?? JSON.parse(result.content[0].text))
      }
    })
    send({
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'liwan-jev-review', version: '1' } },
    })
  })
}

const fmt = (value, digits) => (value === undefined ? '-' : value.toFixed(digits))

export function formatTable(evaluation) {
  const previous = Object.fromEntries((evaluation.comparison ?? []).map((c) => [c.metric, c]))
  const rows = Object.entries(evaluation.metrics).map(([metric, m]) => {
    if (!m.applicable) return [metric, 'n/a', '', '']
    const change = previous[metric]
    return [metric, fmt(m.score, 1), fmt(m.confidence, 2), change ? `${fmt(change.previousScore, 1)} -> ${change.delta >= 0 ? '+' : ''}${fmt(change.delta, 1)}` : '']
  })
  const header = ['dimension', 'score', 'confidence', 'previous -> delta']
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()
  const out = [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)]
  out.push('', 'priorities:')
  if (!evaluation.priorities.length) out.push('  (none)')
  for (const p of evaluation.priorities) out.push(`  [${p.severity}] ${p.metric}: ${p.reason}`)
  return out.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const diff = args.diff ? readFileSync(args.diff, 'utf8') : diffAgainst(args.base)
  if (!diff.trim()) {
    console.log('empty diff: nothing to review')
    return
  }
  const problems = secretProblems(diff)
  if (problems.length) {
    console.error('refusing to send the diff to Jev:')
    for (const problem of problems) console.error(`  ${problem}`)
    return
  }
  const input = { task: args.task, diff, repositoryContext: REPOSITORY_CONTEXT }
  if (args.previous) input.previousEvaluation = JSON.parse(readFileSync(args.previous, 'utf8'))
  const evaluation = await callJevReview(input, readApiKey())
  console.log(args.json ? JSON.stringify(evaluation, null, 2) : formatTable(evaluation))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .catch((error) => console.error(`jev review skipped: ${error.message}`))
    .finally(() => process.exit(0))
}
