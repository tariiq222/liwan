# Integration rules: preserve approved work through pull requests

This is the operational source for integration. `AGENTS.md` owns architecture and
product contracts; `REVIEW.md` owns review criteria; `docs/testing.md` owns check
commands. The former direct-push exception is superseded.

## Authorization and deterministic CI

The owner's 2026-10-24 reset keeps normal deterministic CI and removes the
model-driven review, repair, merge and release controllers. The required
status-check policy is **`ci-result` only**, on the current PR head. Review of the
actual diff still follows `REVIEW.md`; any selected available agent or a human
may perform it, without an exclusive model requirement or paid API fallback.

Keep a PR draft while local preparation is incomplete. Marking ready requests
CI and review; it does not by itself authorize merging or release.
A local commit, the push of the task branch, opening the PR and marking it ready are covered by the
standing authorization below; merging, release, deployment and the other excluded operations
need the owner's explicit words for their scope. Prior approved product, access and data decisions remain binding. New
changes require updated evidence and any authorization their scope needs.

The `ci` workflow reports checks; it does not repair code, merge PRs, create tags or deploy. The `publish` workflow runs only on `release/**` tags and calls the staging hook on release tags as described in the flow below.
Task authorization, remote publication, merge, release, production deployment
and cleanup remain distinct operations. Local consolidation authority does not
authorize production deployment. Missing services, stale checks and failed
checks never justify bypassing branch protection.

### Standing authorization (owner decision 2026-11-11)

The owner authorizes every agent (Claude and Codex), in every session, to do the following
without asking each time, provided the evidence rules of this file hold:

- commit the task's work locally on its task branch (the orchestrator commits);
- push the task branch, open its pull request and mark it ready (owner decision 2026-11-23,
  replacing the requirement of explicit words for these steps), only after the independent reviewer
  returned no unresolved findings, the tester passed on sensitive work, the applicable local checks
  passed. Marking ready does not wait for CI: CI does not run on drafts, so a green current-head `ci-result`
  is a condition for the merge only;
- resolve a review thread after verifying the fix in the code;
- after a merge, return the lanes with `python3 -B tools/wt.py done --orchestrator <id>`, or remove a temporary
  lane with `python3 -B tools/wt.py lane remove <name>`, once the content is preserved and no
  process uses the worktree (step 6).

Merging and enabling auto-merge need the owner's explicit words in the current conversation, each
for its own step. The owner keywords below are explicit words for the steps they name. Words given
for one branch, one PR or one conversation do not carry to the next. The 2026-11-11
requirement of explicit words for push, PR and ready is superseded.

Also excluded, and needing the owner's explicit words each time: a `release/19.0.X.Y.Z`
tag («انشر على الاستيج»), deploying to production («انشر على الإنتاج»), deploying to any other server by hand, a DNS cutover, force-push or history rewrite, a direct push to `main`,
bypassing branch protection or a failing check, and merging unrelated worktrees.
Changes to external source versions still follow [UPDATE_POLICY.md](../UPDATE_POLICY.md).
Missing, stale or failing checks never widen this authorization.

Fix-alone scope: within its task an agent fixes or deletes errors, stale text and
dead code without asking. A change in behavior the user can see, or reversing a
recorded owner decision, goes to the owner as options with a recommended default.

Owner keywords:

- «كومت ودمج» means: commit the requested work and prepare its integration against
  the latest remote `main`, preserving previously approved behavior and adding the
  requested changes, then follow the six steps. It does not authorize undoing an
  earlier decision, merging unrelated worktrees or deleting recovery material.
- «انشر» means: merge the ready PR after current-head `ci-result` is green, and return the lanes (`wt done --orchestrator <id>`, or `wt lane remove` for a temporary lane). When the PR does not exist yet, it first runs the automatic steps (commit, checks, independent review and its fixes, push, PR, ready). It never means a direct push to `main`,
  a release tag, or a deployment to staging or production. Nothing follows `main` by itself: a merge
  updates no environment (see [the flow](#from-task-branch-to-each-environment-owner-decision-2026-11-21)).
- «دمج» or «ادمج» means: merge the work the owner is pointing at into `main` through its PR,
  following the six steps. These are also the words that allow enabling auto-merge on that PR.
  When that work has no PR yet, the automatic steps (independent review, push, PR, ready) run first. It never means a direct push to `main`, a release tag, or a deployment to staging or production (a merge updates no environment, as under «انشر»).
- «انشر على الاستيج» means: create and push the tag `release/19.0.X.Y.Z` on a `main` commit that passed the release checks below, so that the staging environment updates through its hook. It
  needs that commit to be on `main` already; with the work still on a branch, «انشر» comes first. It never
  means production.
- «انشر على الإنتاج» means: release to production the tag that staging already served and passed, by starting
  the production job from Openship. If `main` is ahead of the staged tag, the answer says so; it does not
  stage silently. «انشر» alone never reaches staging or production.

### Review-approval constraint on `protect-main` (recorded 2026-10-24)

The active `protect-main` ruleset requires `ci-result` on the current head, blocks
force-pushes and deletions, and requires every review conversation resolved, but
sets `required_approving_review_count` to `0`. The repository has a single human
account, and GitHub does not let an author approve their own pull request, so any
higher count or `require_last_push_approval` would block every merge, including
the owner's own. The owner therefore keeps the count at `0` and accepts that a
PR author can merge their own PR once current-head `ci-result` is green.

This is a recorded gap, not an approval of self-merge quality. Raising the count
becomes possible as soon as a second collaborator exists; until then, the
independent review below is a rule of this file and does not gate the merge
mechanically. Do not describe the repository as review-protected while the
count stays at `0`.

### Independent review before every push (owner decision 2026-11-21)

Every push of a task branch, and so every publication, is preceded by an independent
review of that branch. It applies to ordinary and [sensitive](#sensitive-change-and-batching-single-definitions) changes alike.

- When: after the local commit and the applicable local checks, before the push.
- Who: an independent reviewer as [REVIEW.md](../../REVIEW.md#review-evidence-and-authorization)
  defines it. Each tool picks its reviewer under its own routing; the step and the
  reviewer's independence are mandatory, a model or provider is not.
- What: the whole branch diff against current `origin/main`. The reviewer opens the code
  the diff touches and follows `REVIEW.md`.
- Evidence: the reviewer checks each finding in the code before reporting it, with
  `file:line` and the input or state that breaks it. A guess is not a finding.
- Outcome: confirmed findings are fixed, or explicitly accepted by the owner, before the
  push. After a fix, repeat the affected checks and review the fix and the behavior it
  affects before pushing; name the reviewed head in the PR.

Push, PR and ready follow automatically once this review has no unresolved findings
(see the standing authorization above); merge and release still need the owner's explicit words.

## Sensitive change and batching (single definitions)

These two definitions are the only ones; other files link here and do not restate them.

**Sensitive change** (owner list, 2026-11-21): a change to money, authorization (authentication included), schema
or migrations, security, tenant isolation, or the CI rules that decide what must pass, or a change coupled across
layers. A sensitive change gets its own task branch and its own PR, so it does not hold other work back, and its
pre-push review also focuses on those boundaries (see "Keep the PR loop short").

**Batching.** Small tasks that share a scope (one session or one area) are commits on one task branch and go in
one PR: it stays draft until the batch is complete, then goes ready once (one CI run, one review). A change that
needs an owner decision, or a sensitive change, is not part of that batch. The branch
`<prefix>/tools-integrate-<slug>` is only for integrating branches that are already separate, coupled and must
land together: it merges only those agreed branches with merge commits and goes in one PR to `main`.

## Six integration steps

1. **Record the live baseline.** Read the canonical checkout's current policy
   and compare it with the latest committed remote policy. Inspect both
   worktrees' dirty paths and owners. Fetch `origin` without resetting a checkout
   or pruning refs; record local `main`, remote `main`, incoming branch/head,
   PR state and lane holders. Remote `main` is the publication baseline; local
   `main` can be stale. Resolve policy conflicts with the current owner decision.
2. **Prepare one candidate.** Work in a lane taken with `wt take` ([parallel-work.md](../parallel-work.md#lane-pool)). Bring the
   latest remote `main` into the candidate without rebasing another owner's
   branch. Batching and sensitive changes follow the
   [single definitions](#sensitive-change-and-batching-single-definitions): small tasks are commits on one task
   branch and one PR; a sensitive change gets its own PR; `<prefix>/tools-integrate-<slug>` integrates separate
   coupled branches only, with merge
   commits and one PR to `main`. Preserve incoming commits and approved behavior;
   do not replace entire files, use blanket `ours`/`theirs`, reset `main` to an
   incoming tree or treat ancestry as proof behavior survives. Never `git reset --soft origin/main` to update or
   squash a branch: use `git rebase origin/main`, or squash only down to `$(git merge-base origin/main HEAD)`,
   because a soft reset moves HEAD without the tree and stages the inverse of every commit merged since the
   branch started. `tools/git_policy.py` and the `commit-msg` hook refuse such a silent revert of a recent
   `main` commit unless the message acknowledges it with `Revert "..."` or a `Reverts: <sha>` trailer.
   The same check fires when a deliberate cleanup restores a recently added line or file to its exact
   pre-commit state; name the commit it removes with `git revert` or `Reverts: <sha>` there too, as the
   error message explains.
   Generated API files follow the rule in [parallel-work.md](../parallel-work.md#generated-api-files): the branch that changes a route
   regenerates and commits both, and PR CI checks them. Two PRs that both regenerate can merge textually clean and
   leave `main` stale; the next PR then regenerates them (the check names the fix), so nothing stays broken.
3. **Review the complete delta.** Compare the candidate with the recorded
   remote baseline, including deletions, shared UI, navigation, permissions,
   contracts, migrations and regression tests. Review the actual diff following
   `REVIEW.md`; addon/contract changes need Odoo-aware review. Before every push
   this is the [independent review](#independent-review-before-every-push-owner-decision-2026-11-21). Keep compatible
   prior decisions. If the request conflicts with one, preserve it and ask for
   that specific decision; general merge authorization does not reverse it.
4. **Verify the combined result.** Run the Git and architecture policies against
   the recorded baseline and follow the [local verification policy](../testing.md#fast-local-loop)
   for any additional local checks. Record commands, commit, environment, results,
   and coverage left to CI in the PR. Retain baseline regression requirements.
   Disclose any reproduced baseline failure. After local preparation and
   publication, the PR is marked ready automatically (standing authorization) and CI runs on it.
   Before merging, require successful current-head `ci-result` and every selected stage; inspect
   skipped stages and scope. An old green head, local checks or a conflict check
   alone does not establish readiness for protected remote integration.
5. **Merge the candidate.** Recheck the current base/head, current-head
   CI, resolved review findings and conversations, and that the owner's explicit
   words in the current conversation cover this merge.
   Fix failures in the owned scope and repeat affected checks after a change.
   When the head moves, update its evidence before merging. A moved base alone
   is not a reason to merge `main` into a branch: that cancels and restarts its
   CI. Bring `main` in only when GitHub reports a conflict or the branch needs a
   change that just merged. Use the normal protected PR merge; do not force-push, bypass
   protection, relax a test or assume a green check grants permission. Quota or
   service exhaustion is a blocker to report, never a reason for a paid fallback.
6. **Verify and synchronize.** Confirm the PR is merged and record its actual
   merge SHA and post-merge CI result. Fetch and compare local/remote `main`.
   Fast-forward local `main` only when behind without divergence and clean,
   or after proving every dirty/untracked path is disjoint from the incoming
   changes (including directory collisions), saving a byte-level snapshot of
   those paths, and verifying it unchanged afterward. If that cannot be proved,
   leave the checkout intact and report it. Never auto-stash, reset, force-push
   or discard edits to synchronize. Release and deployment need their own
   authorization and evidence. Cleanup is a separate action: ancestry alone
   does not preserve uncommitted, untracked or ignored files, scratch data or
   runtime state. Inspect ownership, preservation and process use, then return the
   lane with `tools/wt.py done`, or use `tools/wt.py lane remove` for a temporary lane.

## From task branch to each environment (owner decision 2026-11-21)

GitHub is the only system for source, CI, image build and release; no other git host or registry is part of
the path. The keyword ladder is the owner's decision of 2026-11-18 and 2026-11-20; this section records the one flow that reaches
the two server environments, staging and production.

Owner decision 2026-11-21: the development server environment is
cancelled. LiwanOS has two server environments, staging and production. «انشر» ends at `main` and nothing follows `main` by itself.
«انشر على الاستيج» and «انشر على الإنتاج» are unchanged. The workflow `.github/workflows/publish.yml`,
the release command and the server setup are described in `deploy/release/README.md`,
[environment-bringup.md](../operations/environment-bringup.md) and
[tooling-server.md](../operations/tooling-server.md).

| Step | Who says it | Who acts | What happens |
| --- | --- | --- | --- |
| 1. Lane and branch | none | the orchestrator | `npm run wt -- take <branch> --holder <worker role(s)> --orchestrator <id>` starts the branch from current `origin/main`. |
| 2. Local commit | none (standing authorization) | the orchestrator | Commit on the task branch with the applicable local checks. |
| 3. Independent review | none | an independent reviewer | The [review before every push](#independent-review-before-every-push-owner-decision-2026-11-21); confirmed findings are fixed first. |
| 4. Push, PR, ready | none (standing authorization, owner decision 2026-11-23) | the orchestrator | Push the task branch, open the PR as a draft, and mark it ready once step 3 is clean, the tester passed on sensitive work and the applicable local checks passed (the conditions in the standing authorization above). CI then runs. |
| 4a. «انشر» | the owner | the orchestrator | After current-head `ci-result` is green, merge the ready PR, then return the lanes (steps 5 and 6 above). |
| 5. Push to `main` | nobody | `.github/workflows/publish.yml` | A merge to `main` runs CI only. The publish workflow does not start: no image is built, no release document is published, no hook is called and no server is updated. |
| 6. «انشر على الاستيج» | the owner | the coordinator | After checking that the `main` CI for the commit is green, the coordinator creates and pushes `release/19.0.X.Y.Z` on it. The publish workflow runs only on a `release/**` tag and builds arm64 only. On the tag push it checks that the commit is on `main`, builds the nine arm64 images on `ubuntu-24.04-arm` (about 17 to 18 minutes, measured), pushes them to private GHCR, publishes the release document and calls the staging hook. Staging therefore waits for that build; Oracle `liwanos-staging` (arm64) then serves the tag. A tag that fails on staging is never promoted; the fix takes the next number. |
| 7. «انشر على الإنتاج» | the owner, after testing staging | the owner starts the job from Openship; the coordinator prepares and verifies | The job `liwan-production-release` has no hook and no credential on GitHub. It is started with an explicit tag (`release.py run --environment production --tag release/19.0.X.Y.Z`) and never picks the highest tag by itself (owner decision 2026-11-21). It takes only a tag that staging served: production's release config names the staging proof URL and the staging public key, so the run fetches `/_liwan/release-proof/<commit>.json` over HTTPS and refuses with `staging_proof_missing` or `staging_proof_invalid` before anything stops, with no flag that skips it; the pair is required by its `LIWAN_RELEASE_TAG_POLICY=explicit`, so a config without it is `invalid_config` instead of an ungated release ([release/README.md](../../deploy/release/README.md), row A4.7a of [environment-bringup.md](../operations/environment-bringup.md)). That proof establishes that staging served the tag, commit and release document; it does not establish that staging passed its checks, so the owner and the coordinator still confirm that before «انشر على الإنتاج». Oracle `liwanos-prod` (arm64) serves it. Owner decision in principle, 2026-11-21, on who starts the production and rollback jobs: «نستخدم الايجنت الموجود في اوبن شيب ونضع اليه سليمه له مع ربطه معنا هنا». It is not built: the Openship assistant is still disabled on the panel that runs on `liwanos-staging` and no agent exists. The hosts `liwanos-prod` and `liwanos-staging` were registered in that panel on 2026-11-21; production is reached by SSH from the staging address through the panel, and the Contabo tooling host reaches neither Oracle host. Until that mechanism is designed and approved, the owner starts the production job from Openship himself. |

Rules of the flow:

- Every server runs the same release command, `deploy/release/release.py run --environment <env>`. It trusts
  GitHub and verifies exactly this: the candidate is a `release/19.0.X.Y.Z` tag whose commit is on
  `main`; the release document's commit matches; the document covers the server's platform (arm64); and every digest
  points into `ghcr.io/tariiq222`. Servers pull from private GHCR with a read-only credential; nothing on GitHub
  or on a runner holds a production credential.
- Residual risk, stated plainly: the release document is not signed. Anyone with write access to the repository
  (a pushed branch or a `release/**` tag carrying a changed workflow) could publish a document for a `main`
  commit; fork pull requests cannot. The mitigation is owner-side and not done: a GitHub tag ruleset protecting
  `release/**`, and write access to the repository kept to the owner (row A0.2 of environment-bringup.md).
  Attestation may be revisited later.
- The staging proof narrows that gap and does not close it. It binds a tag, its commit and the exact release-document
  digest to a signature made on the signing host with a key that never leaves it, so a document swapped in the registry
  after staging served the release no longer passes. An attacker who can publish a `release/**` tag and a document for an
  unreviewed `main` commit is still served by staging, which then signs it, so write access stays the same owner-side
  control. The fetch itself trusts HTTPS with the system CA store and follows no redirect; pinning a private CA is
  deferred. The gate follows the environment's tag policy, never its name: `explicit` (production) refuses
  `invalid_config` without the pair and so has no ungated state, while `highest` (staging) may release without verifying
  and says so in one log line.
- Publish runs for one commit are serialized (the concurrency group is keyed on the commit), and the workflow runs only on a
  `release/**` tag, so a release document exists only for a tagged commit.
- A pull request never triggers the publish workflow, so pull-request code never reaches the registry or a hook.
- Packages in GHCR stay private always, also while the repository is public. The mechanism: the publish workflow
  refuses to push unless each of the ten packages already exists and is private; it never creates one (owner-side
  pre-creation: row A0.1 of environment-bringup.md). The repository is public for now
  and turns private on the owner's word; the build then moves to a self-hosted runner and servers also need a
  read token for the source (checked on 2026-11-21 in `docs/operations/environment-bringup.md`).
- Each owner word covers its own step only: «انشر» alone ends at `main`; staging and production
  each need their own words.

## Local-only integration

An explicit request to consolidate into local `main` may authorize local commits
and merges without authorizing publication. Preserve all source work and dirty
paths, prepare the combined result in an isolated candidate, and run the
applicable combined checks and review before updating local `main`. Record that
there is no remote PR/CI evidence for this local-only action. The protected PR
procedure above remains required for subsequent remote publication.

## Keep the PR loop short

Enable auto-merge (`gh pr merge <n> --auto --merge`) only when the owner says «دمج» or «ادمج» for
that PR, or names auto-merge. GitHub then merges the PR the moment the current-head `ci-result` is
green, without waiting for an agent to come back. Under «انشر» alone the agent waits for the green
check and merges the PR itself. Auto-merge never bypasses protection: it waits
for the required check and for resolved conversations. Disable it (`gh pr merge <n> --disable-auto`)
before pushing further changes to that PR. Do not enable it on a PR that needs an owner
decision or a separate authorization, or on a [sensitive change](#sensitive-change-and-batching-single-definitions): those merge only after the
boundary-focused review described below. Inspect the selected and skipped stages before
enabling it. Step 6 (verify and synchronize) still runs after the merge.

Keep the PR in draft while its diff, applicable local checks and review notes are
being prepared. Mark it ready once the candidate is stable, and batch related
review fixes before pushing again. If a selected check fails, read that job
first and reproduce the failure locally when needed to diagnose or verify the fix.

CI reruns (owner decision 2026-11-21, from PR #799): when a check fails and no code change is needed (a flaky or
infrastructure failure), rerun only the failed jobs with `gh run rerun <run-id> --failed`, never the whole run.
When a fix commit is needed, say before pushing which stages will repeat, and make it one push that carries all the fixes.

For a [sensitive change](#sensitive-change-and-batching-single-definitions), the pre-push review also focuses on
those boundaries. Include evidence for the relevant refusal or failure paths and name
the exact head reviewed. For coupled PRs, review the combined candidate and
verify it under step 4. GitHub requires the green check and resolved threads;
it does not enforce an independent approval on this repository.

## PR handoff

Use the repository PR template. Name one bounded outcome, included branches and
prerequisites; record baseline/head, verification evidence, review findings and
unverified areas. Dependent branches declare the prerequisite and stay draft
until tested against the intended combined result. When the parent merges,
update and retest the child against current `main`; do not deliver inherited
changes twice. A clean merge simulation proves textual compatibility only.

## GitHub protection policy and live settings

Publish through a PR with current-head `ci-result` from GitHub Actions,
resolved conversations and normal merge commits. The branch need not be up to
date with `main` (owner decision 2026-10-27: the strict policy restarted CI on
every concurrent merge); `ci` on `main` after each merge catches a semantic
conflict between two green PRs. Do not merge `main` into a running or green PR
only because `main` moved (step 5). Merge PRs that turn green together where
possible. No protection
bypass, force updates or branch deletion is permitted. A mandatory second-account
or model-provider approval is not part of the owner's reset.

Inspect actual rulesets and required checks before remote delivery. A source
change does not modify GitHub settings or prove the live rules match this policy.
Report mismatches and obtain any required settings authorization; do not add a
required context whose producer no longer exists or bypass a stale gate.

## Release numbers

Publishing a `release/19.0.X.Y.Z` tag requires explicit owner authorization and
all thirteen `ci` stage groups, every matrix job and `ci-result`, green in a full
run on that exact `main` commit, with no skipped groups. Inspect the existing
immutable tags before choosing the next final numeric component. Scoped PR CI
does not prove a full release run. The tag is created only on a commit whose full `main` CI run is green
([flow](#from-task-branch-to-each-environment-owner-decision-2026-11-21), step 6). Release tags do not alter addon schema
versions or authorize production deployment; those retain their own checks and
authorization.

## Delivery flow

```mermaid
flowchart TD
    A[Isolated candidate and local checks] --> B[Independent review of the branch diff]
    B --> C[Push and PR publication]
    C --> D[Current-head deterministic CI]
    D --> E{Checks pass and merge allowed?}
    E -->|Failure or missing evidence| F[Fix owned scope or report blocker]
    F --> B
    E -->|Yes| G[Normal protected PR merge]
    G --> H[Verify main and post-merge CI]
    H --> I[Full main CI for release]
    I --> J[Explicitly authorized immutable release tag]
    J --> K[Separately authorized production deployment]
```
