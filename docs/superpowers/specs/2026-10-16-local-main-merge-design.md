# Local main merge gate

Owner-approved in chat, 2026-10-16: one local merge command prepares an isolated combined result, runs the required full checks, leaves main unchanged on failure, and accepts only the tested result on success. No remote CI service, temporary tunnel or implicit push.

## Contracts and safety

- Coordinator owns tools/merge_main.py, tools/test_merge_main.py, package.json, integration/testing/agent docs. Worker owns tools/local_ci.py, tools/test_local_ci.py, .woodpecker.yml and focused deploy pipeline tests.
- Runner interface: `python3 -B tools/local_ci.py --base SHA --commit SHA --report-dir ABS`. Executes .woodpecker.yml through Woodpecker CLI local backend with main/manual/webvue metadata. Writes report.json and pipeline.log, exits0 only on successful full execution; no test-skip/check-command override. Docker/PostgreSQL failures stop the gate.
- Pipeline remains the single source of the twelve check groups. No external paid/model calls. Runner uses dedicated ephemeral PostgreSQL, unique containers/networks/files/ports rather than global dev roles and databases. Upstream Odoo is read-only and its pinned commit is checked.
- Merge CLI: `npm run merge:main -- codex/<area>-<slug>`. A local branch, clean incoming worktree and tracked-clean main are required. Preserve non-colliding untracked main files; refuse collisions (including ignored files and symlink parents).
- Fetch/compare origin if configured. Reject main behind/diverged from origin/main. Record exact base/source SHAs. One shared flock coordinates gate invocations; recheck both SHAs and cleanliness before promotion.
- Create the actual no-fast-forward merge commit in a detached candidate worktree. Verify that exact commit. Promote with ff-only to that existing tested merge commit: no new merge calculation can introduce an untested tree. This preserves no-ff merge history and avoids reset/update-ref/force operations. Document this explicit gate path alongside the existing manual no-ff workflow.
- Failure, conflict, interrupted verifier, main/source movement, unavailable tooling or a failed check must never advance main. Preserve the failed candidate and logs for review; no implicit worktree/branch cleanup.
- A direct git command outside this tool can bypass it; this is the approved local merge entrypoint, not server protection. No claim that all manual Git operations are technically forbidden.

## Review focus

1. Failures/races leave main HEAD, tracked files, index and unrelated files intact.
2. Exact tree tested is the tree accepted; no stale receipt reuse or partial/zero-check success.
3. Shell/branch/path inputs cannot become command text or overwrite user paths.
4. Local scratch resources are isolated; dependency/generated directories are not shared.
5. Old main changes are preserved and no branch push/cleanup occurs implicitly.
