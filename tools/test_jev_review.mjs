import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addedLines, diffPaths, formatTable, parseArgs, secretProblems } from './jev_review.mjs'

const diffOf = (path, added) => [
  `diff --git a/${path} b/${path}`,
  `--- a/${path}`,
  `+++ b/${path}`,
  '@@ -0,0 +1 @@',
  `+${added}`,
].join('\n')

test('parseArgs defaults to main and requires a task', () => {
  assert.deepEqual(parseArgs(['--task', 't']), { base: 'main', diff: null, task: 't', previous: null, json: false })
  assert.equal(parseArgs(['--task', 't', '--json', '--base', 'x']).base, 'x')
  assert.throws(() => parseArgs([]), /--task/)
  assert.throws(() => parseArgs(['--task', 't', '--bogus']), /unknown/)
})

test('diffPaths lists both sides of a rename', () => {
  const diff = 'diff --git a/old.md b/new.md\nsimilarity index 100%\n' + diffOf('tools/x.py', 'pass')
  assert.deepEqual(diffPaths(diff), ['new.md', 'old.md', 'tools/x.py'])
})

test('addedLines groups added lines by file', () => {
  assert.deepEqual(addedLines(diffOf('a.py', 'x = 1')), { 'a.py': 'x = 1' })
})

test('secretProblems refuses secret paths and literal deploy secrets', () => {
  assert.deepEqual(secretProblems(diffOf('apps/web/x.ts', 'const a = 1')), [])
  assert.match(secretProblems(diffOf('deploy/.env', 'A=1')).join(), /secret-bearing path: deploy\/\.env/)
  assert.match(secretProblems(diffOf('deploy/app.yml', 'password: hunter2real')).join(), /literal secret/)
  assert.deepEqual(secretProblems(diffOf('deploy/.env.example', 'password: change-me')), [])
  // The fallback rule must also gate what leaves the machine for the advisory review.
  assert.match(
    secretProblems(diffOf('deploy/k6/probe.js', "const PASSWORD = __ENV.PASSWORD || 'hunter2real'")).join(),
    /credential fallback literal/,
  )
  assert.deepEqual(secretProblems(diffOf('deploy/k6/probe.js', "const PASSWORD = requiredEnv('PASSWORD')")), [])
})

test('formatTable shows scores, deltas and priorities', () => {
  const table = formatTable({
    metrics: {
      correctness: { applicable: true, score: 8, confidence: 0.9 },
      observability: { applicable: false },
    },
    priorities: [{ metric: 'correctness', severity: 'medium', reason: 'edge cases' }],
    comparison: [{ metric: 'correctness', previousScore: 6.5, currentScore: 8, delta: 1.5, direction: 'improved' }],
  })
  assert.match(table, /correctness\s+8\.0\s+0\.90\s+6\.5 -> \+1\.5/)
  assert.match(table, /observability\s+n\/a/)
  assert.match(table, /\[medium\] correctness: edge cases/)
})
